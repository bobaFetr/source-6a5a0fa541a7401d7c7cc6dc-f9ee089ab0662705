import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import ssh2 from 'ssh2'
import { passwordSsh } from '../src/server/password-ssh.ts'

test('real SSH handshake enforces password authentication and host verification', async t => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const key = ssh2.utils.parseKey(privateKey).getPublicSSH().toString('base64')
  let executions = 0
  const methods = []
  const clients = new Set()
  const server = new ssh2.Server({ hostKeys: [privateKey] }, client => {
    clients.add(client)
    client.on('error', () => {})
    client.on('close', () => clients.delete(client))
    client.on('authentication', ctx => {
      methods.push(ctx.method)
      if (ctx.method === 'password' && ctx.username === 'ubuntu' && ctx.password === ' correct password ') ctx.accept()
      else ctx.reject(['password'])
    })
    client.on('ready', () => client.on('session', accept => {
      accept().on('exec', (acceptExec, _reject, info) => {
        executions++
        const stream = acceptExec()
        if (info.command === 'wait') { server.emit('waiting'); return }
        if (info.command === 'unicode') {
          const bytes = Buffer.from('Ubuntu · café 日本語')
          for (const byte of bytes) {
            stream.write(Buffer.from([byte]))
            stream.stderr.write(Buffer.from([byte]))
          }
          stream.exit(0)
          stream.end()
          return
        }
        stream.write('Ubuntu test host')
        stream.exit(0)
        stream.end()
      })
    }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { for (const client of clients) client.end(); server.close() })
  const coordinates = { host: '127.0.0.1', port: String(server.address().port), username: 'ubuntu', password: ' correct password ' }
  const success = await passwordSsh(coordinates, 'hostname', [key])
  assert.deepEqual(success, { ok: true, output: 'Ubuntu test host' })
  const unicode = await passwordSsh(coordinates, 'unicode', [key])
  assert.deepEqual(unicode, { ok: true, output: 'Ubuntu · café 日本語' })
  const wrongPassword = await passwordSsh({ ...coordinates, password: 'wrong' }, 'hostname', [key])
  assert.equal(wrongPassword.ok, false)
  assert.match(wrongPassword.output, /Authentication failed/)
  const wrongUser = await passwordSsh({ ...coordinates, username: 'wrong' }, 'hostname', [key])
  assert.equal(wrongUser.ok, false)
  const wrongHost = await passwordSsh(coordinates, 'hostname', ['wrong-key'])
  assert.equal(wrongHost.ok, false)
  assert.match(wrongHost.output, /host key/)
  assert.equal(executions, 2, 'Rejected authentication must never execute commands')
  assert.ok(methods.length > 0 && methods.every(method => method === 'password'))
  const cancelled = new AbortController()
  cancelled.abort()
  assert.deepEqual(await passwordSsh(coordinates, 'hostname', [key], 20000, cancelled.signal), { ok: false, output: 'SSH operation cancelled.' })
  assert.equal(executions, 2, 'A pre-cancelled check must not execute a command')
  const active = new AbortController()
  const waiting = once(server, 'waiting')
  const pending = passwordSsh(coordinates, 'wait', [key], 20000, active.signal)
  await waiting
  active.abort()
  assert.deepEqual(await pending, { ok: false, output: 'SSH operation cancelled.' })
})
