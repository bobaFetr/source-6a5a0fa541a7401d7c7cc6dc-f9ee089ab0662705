import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import ssh2 from 'ssh2'
import { streamProcesses, monitorCommand } from '../src/server/process-stream.ts'
import { parseProcessMetrics } from '../src/components/process-metrics.ts'

test('monitor interval is allowlisted', () => {
  assert.match(monitorCommand(3), /-d 3/)
  assert.match(monitorCommand(3), /-E k/, 'Memory summaries must not lose precision through GiB scaling')
  assert.doesNotMatch(monitorCommand(1), /while| -n /, 'Use continuous sampling instead of restarting top')
  for (const interval of [0, -1, 100, '3;id']) assert.throws(() => monitorCommand(interval))
})

for (const interval of [1, 2, 3, 5]) test(`streams fresh samples at ${interval}s over one SSH connection and cancels cleanly`, { concurrency: true }, async t => {
  const summary = 'Tasks: 12 total, 1 running\n%Cpu(s): 10.0 us, 5.0 sy, 0.0 ni, 80.0 id, 4.0 wa, 0.0 hi, 1.0 si, 0.0 st\nKiB Mem : 8000000 total, 2000000 free, 3000000 used, 3000000 buff/cache\nKiB Swap: 0 total, 0 free, 0 used. 4500000 avail Mem\n'
  const firstOutput = 'top - sample1\n' + summary + 'process one'
  const secondOutput = 'top - sample2\n' + summary.replace('10.0 us', '30.0 us').replace('80.0 id', '60.0 id') + 'process two'
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const key = ssh2.utils.parseKey(privateKey).getPublicSSH().toString('base64')
  let connections = 0
  let commands = 0
  let released = 0
  const clients = new Set()
  const server = new ssh2.Server({ hostKeys: [privateKey] }, client => {
    connections++
    clients.add(client)
    client.on('error', () => {})
    client.on('close', () => clients.delete(client))
    client.on('authentication', ctx => ctx.method === 'password' && ctx.password === 'test-password' ? ctx.accept() : ctx.reject(['password']))
    client.on('ready', () => client.on('session', accept => accept().on('exec', (acceptExec, _reject, info) => {
      commands++
      assert.equal(info.command, monitorCommand(interval))
      const channel = acceptExec()
      channel.on('error', () => {})
      // Split frames across network chunks; an initial top frame is never displayed.
      channel.write('top - initial\nold\n' + firstOutput.slice(0, 75))
      const first = setTimeout(() => channel.write(firstOutput.slice(75) + '\n' + secondOutput.slice(0, 75)), interval * 1000)
      const second = setTimeout(() => channel.write(secondOutput.slice(75) + '\ntop - sample3\n'), interval * 2000)
      channel.on('close', () => { clearTimeout(first); clearTimeout(second) })
    })))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { for (const client of clients) client.end(); server.close() })
  const abort = new AbortController()
  const stream = streamProcesses({ host: '127.0.0.1', port: String(server.address().port), username: 'ubuntu', password: 'test-password' }, [key], abort.signal, () => released++, interval)
  const reader = stream.getReader()
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value))
  const second = JSON.parse(new TextDecoder().decode((await reader.read()).value))
  assert.equal(first.output, firstOutput)
  assert.equal(second.output, secondOutput)
  assert.equal(parseProcessMetrics(first.output).cpu, 16)
  assert.equal(parseProcessMetrics(second.output).cpu, 36)
  assert.equal(parseProcessMetrics(second.output).memory, 37.5)
  assert.equal(connections, 1)
  assert.equal(commands, 1)
  assert.ok(second.sampledAt >= first.sampledAt)
  assert.ok(second.sampledAt - first.sampledAt >= interval * 750, 'Continuous frames retain their selected sampling timestamps')
  await reader.cancel()
  abort.abort()
  assert.equal(released, 1)
})

for (const slowBrowser of [false, true]) test(`batched SSH frames stay live with ${slowBrowser ? 'slow' : 'active'} browser consumption`, async t => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const key = ssh2.utils.parseKey(privateKey).getPublicSSH().toString('base64')
  const clients = new Set()
  let released = 0
  const server = new ssh2.Server({ hostKeys: [privateKey] }, client => {
    clients.add(client)
    client.on('error', () => {})
    client.on('close', () => clients.delete(client))
    client.on('authentication', ctx => ctx.method === 'password' ? ctx.accept() : ctx.reject(['password']))
    client.on('ready', () => client.on('session', accept => accept().on('exec', acceptExec => {
      const channel = acceptExec()
      channel.on('error', () => {})
      channel.write('top - initial\nold\ntop - one\n1\ntop - two\n2\ntop - three\n3\ntop - four\n')
    })))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { for (const client of clients) client.end(); server.close() })
  const abort = new AbortController()
  const stream = streamProcesses({ host: '127.0.0.1', port: String(server.address().port), username: 'ubuntu', password: 'test' }, [key], abort.signal, () => released++, 5)
  const reader = stream.getReader()
  if (slowBrowser) await new Promise(resolve => setTimeout(resolve, 200))
  const expected = slowBrowser ? [['one', '1'], ['three', '3']] : [['one', '1'], ['two', '2'], ['three', '3']]
  for (const [name, value] of expected) {
    const sample = JSON.parse(new TextDecoder().decode((await reader.read()).value))
    assert.equal(sample.output, `top - ${name}\n${value}`)
  }
  assert.equal(released, 0)
  abort.abort()
  assert.equal((await reader.read()).done, true)
  await reader.cancel()
  assert.equal(released, 1)
})
