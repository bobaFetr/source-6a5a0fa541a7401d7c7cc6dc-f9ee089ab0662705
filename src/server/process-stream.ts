import { Client } from 'ssh2'
import { StringDecoder } from 'node:string_decoder'
import type { Coordinates } from './ssh-input'

// Keep top running: restarting it between samples adds startup overhead and resets CPU counters.
export function monitorCommand(interval: number) {
  if (![1, 2, 3, 5].includes(interval)) throw new Error('Unsupported sampling interval.')
  return `LC_ALL=C stdbuf -oL top -b -d ${interval} -w 180 -E k -o %CPU`
}

export function streamProcesses(data: Coordinates, keys: string[], signal: AbortSignal, onDone: () => void, interval = 3) {
  const command = monitorCommand(interval)
  let stop = () => {}
  let pendingFrame: { output: string; sampledAt: number; completionDelayMs: number; queuedAt: number } | undefined
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const client = new Client()
      const encoder = new TextEncoder()
      const decoder = new StringDecoder('utf8')
      let buffer = ''
      let frameStartedAt = 0
      let frameStartedMonotonic = 0
      let initialFrame = true
      let done = false
      let untrusted = false
      let deadline: ReturnType<typeof setTimeout>
      const finish = (message?: string, cancelled = false) => {
        if (done) return
        done = true
        pendingFrame = undefined
        clearTimeout(deadline)
        signal.removeEventListener('abort', abort)
        client.destroy()
        onDone()
        if (!cancelled) {
          if (message) controller.enqueue(encoder.encode(JSON.stringify({ error: message }) + '\n'))
          controller.close()
        }
      }
      const abort = () => finish(undefined)
      stop = () => finish(undefined, true)
      const resetDeadline = () => {
        clearTimeout(deadline)
        // Memory reclaim can stall an otherwise healthy VM for tens of seconds.
        // Freshness is shown separately in the browser; silence is not a reason
        // to discard a connection after only 15 seconds.
        deadline = setTimeout(() => finish('Process monitoring timed out. Displayed data is stale.'), 90000)
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      resetDeadline()
      client.on('error', (error: Error & { level?: string }) => finish(untrusted ? 'VM host key verification failed.' : error.level === 'client-authentication' ? 'Authentication failed. Check the Ubuntu username/password and SSH password authentication.' : 'SSH monitoring connection failed.'))
      client.on('close', () => finish('SSH monitoring connection closed.'))
      client.on('ready', () => client.exec(command, (error, channel) => {
        if (done) { channel?.close(); return }
        if (error) { finish('The VM refused the process monitor.'); return }
        resetDeadline()
        channel.on('error', () => finish('The process monitor failed.'))
        channel.on('close', () => finish('The process monitor stopped unexpectedly.'))
        channel.stderr.on('data', () => { /* Do not expose arbitrary server diagnostic output. */ })
        channel.on('data', (chunk: Buffer) => {
          if (done) return
          resetDeadline()
          buffer += decoder.write(chunk)
          if (Buffer.byteLength(buffer) > 1024 * 1024) { finish('Process sample exceeded the size limit.'); return }
          // A subsequent header proves the preceding frame is complete, regardless of SSH chunk boundaries.
          if (!frameStartedAt) {
            const firstHeader = buffer.search(/^top - /m)
            if (firstHeader === -1) return
            buffer = buffer.slice(firstHeader)
            frameStartedAt = Date.now()
            frameStartedMonotonic = performance.now()
            resetDeadline()
          }
          let nextHeader: number
          while ((nextHeader = buffer.slice(6).search(/^top - /m)) !== -1) {
            nextHeader += 6
            const output = buffer.slice(0, nextHeader).trim()
            const sampledAt = frameStartedAt
            const completionDelayMs = Math.max(0, performance.now() - frameStartedMonotonic)
            buffer = buffer.slice(nextHeader)
            frameStartedAt = Date.now()
            frameStartedMonotonic = performance.now()
            resetDeadline()
            if (initialFrame) { initialFrame = false; continue }
            const frame = encoder.encode(JSON.stringify({ output, sampledAt, completionDelayMs }) + '\n')
            // Keep the newest waiting sample rather than closing the stream or
            // building an unbounded backlog for a slow browser.
            if ((controller.desiredSize ?? 0) <= 0) pendingFrame = { output, sampledAt, completionDelayMs, queuedAt: performance.now() }
            else { pendingFrame = undefined; controller.enqueue(frame) }
          }
        })
      }))
      try {
        client.connect({ host: data.host, port: Number(data.port), username: data.username, password: data.password, authHandler: ['password'], tryKeyboard: false, readyTimeout: 10000,
          keepaliveInterval: 5000, keepaliveCountMax: 18,
          hostVerifier: (key: Buffer) => { untrusted = !keys.includes(key.toString('base64')); return !untrusted },
        })
      } catch { finish('Unable to start process monitoring.') }
    },
    pull(controller) {
      if (pendingFrame) {
        const frame = pendingFrame
        pendingFrame = undefined
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ output: frame.output, sampledAt: frame.sampledAt, completionDelayMs: frame.completionDelayMs + Math.max(0, performance.now() - frame.queuedAt) }) + '\n'))
      }
    },
    cancel() { stop() },
  }, { highWaterMark: 1 })
}
