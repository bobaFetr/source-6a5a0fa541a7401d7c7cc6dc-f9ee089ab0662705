import { Client } from 'ssh2'
import { StringDecoder } from 'node:string_decoder'

type Credentials = { host: string; port: string; username: string; password: string }
export function passwordSsh(data: Credentials, command: string, trustedKeys: string[], timeoutMs = 20000, signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    const client = new Client()
    let done = false
    let untrusted = false
    const finish = (ok: boolean, output: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      client.destroy()
      resolve({ ok, output })
    }
    const abort = () => finish(false, 'SSH operation cancelled.')
    const timer = setTimeout(() => finish(false, 'SSH timed out. A remote action may have completed; refresh before retrying.'), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    client.on('error', (error: Error & { level?: string }) => {
      finish(false, untrusted ? 'The VM host key is not trusted or has changed. Verify it from PowerShell before connecting.' : error.level === 'client-authentication' ? 'Authentication failed. Ubuntu rejected the username/password, or SSH password authentication is disabled.' : 'SSH connection failed. Check the VM address, port, and SSH service.')
    })
    client.on('close', () => finish(false, 'SSH connection closed before the operation completed.'))
    client.on('ready', () => {
      client.exec(command, (error, stream) => {
        if (error) return finish(false, 'The server refused this operation.')
        let stdout = ''
        let stderr = ''
        const stdoutDecoder = new StringDecoder('utf8')
        const stderrDecoder = new StringDecoder('utf8')
        let bytes = 0
        const collect = (chunk: Buffer, isError: boolean) => {
          bytes += chunk.length
          if (bytes > 512 * 1024) return finish(false, 'Server output exceeded the 512 KB limit.')
          if (isError) stderr += stderrDecoder.write(chunk)
          else stdout += stdoutDecoder.write(chunk)
        }
        stream.on('data', (chunk: Buffer) => collect(chunk, false))
        stream.stderr.on('data', (chunk: Buffer) => collect(chunk, true))
        stream.on('error', () => finish(false, 'The SSH operation failed.'))
        stream.on('close', (code: number | null) => {
          stdout += stdoutDecoder.end()
          stderr += stderrDecoder.end()
          finish(code === 0, code === 0 ? stdout.trim() || 'Operation completed.' : stderr.trim() || 'Remote command failed.')
        })
      })
    })
    try {
      client.connect({
        host: data.host, port: Number(data.port), username: data.username, password: data.password,
        // No key, agent, or "none" fallback: the server must accept the password.
        authHandler: ['password'], tryKeyboard: false, readyTimeout: 10000,
        hostVerifier: (key: Buffer) => {
          const trusted = trustedKeys.includes(key.toString('base64'))
          untrusted = !trusted
          return trusted
        },
      })
    } catch { finish(false, 'Unable to start the SSH connection.') }
  })
}
