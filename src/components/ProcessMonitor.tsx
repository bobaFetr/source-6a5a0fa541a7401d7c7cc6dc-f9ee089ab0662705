import { useEffect, useState } from 'react'
import { Pause, Play, RefreshCw } from 'lucide-react'
import type { Coordinates } from '../server/ssh-input'
import { parseProcessMetrics, type PerformanceSample } from './process-metrics'
import { PerformancePanel } from './PerformancePanel'
import { ProcessMessageDecoder } from './process-messages'
import { processFreshness } from './process-freshness'
import { canRetryMonitoring, monitoringRetryDelay, waitForMonitoringRetry } from './process-retry'

export function ProcessMonitor({ coordinates }: { coordinates: Coordinates }) {
  const [running, setRunning] = useState(true)
  const [collecting, setCollecting] = useState(true)
  const [interval, setIntervalSeconds] = useState(3)
  const [output, setOutput] = useState('')
  const [samples, setSamples] = useState<PerformanceSample[]>([])
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [receivedAt, setReceivedAt] = useState<number | null>(null)
  const [completionDelay, setCompletionDelay] = useState(0)
  const [arrivalInterval, setArrivalInterval] = useState<number | null>(null)
  const [retrying, setRetrying] = useState(false)
  const { host, port, username, password } = coordinates

  useEffect(() => {
    if (!running) return
    const abort = new AbortController()
    setError('')
    setCollecting(true)
    setRetrying(false)
    setArrivalInterval(null)
    let previousArrival: number | null = null
    let firstSample = true
    async function monitor() {
      let attempts = 0
      while (!abort.signal.aborted) {
        let responseStatus: number | undefined
        try {
          const response = await fetch('/api/processes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, username, password, interval }), signal: abort.signal,
          })
          if (!response.ok) {
            responseStatus = response.status
            const failure = await response.json().catch(() => null)
            throw new Error(typeof failure?.error === 'string' ? failure.error : `Unable to start monitoring (HTTP ${response.status}).`)
          }
          if (!response.body) throw new Error('Streaming is unavailable.')
          const reader = response.body.getReader()
          const decoder = new ProcessMessageDecoder()
          try {
            while (!abort.signal.aborted) {
              const { value, done } = await reader.read()
              if (done) throw new Error('Monitoring connection closed.')
              for (const sample of decoder.push(value)) {
                if ('error' in sample) throw new Error(sample.error)
                if (!abort.signal.aborted) {
                  const receivedAt = performance.now()
                  if (previousArrival !== null) setArrivalInterval((receivedAt - previousArrival) / 1000)
                  previousArrival = receivedAt
                  setOutput(sample.output)
                  const metrics = { ...parseProcessMetrics(sample.output), sampledAt: sample.sampledAt, breakBefore: firstSample }
                  firstSample = false
                  setSamples(previous => [...previous, metrics].slice(-120))
                  setCollecting(false)
                  setRetrying(false)
                  setError('')
                  attempts = 0
                  setUpdated(sample.sampledAt)
                  setReceivedAt(receivedAt)
                  setCompletionDelay(sample.completionDelayMs)
                  setNow(receivedAt)
                }
              }
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        } catch (cause) {
          if (abort.signal.aborted) return
          const message = cause instanceof Error ? cause.message : 'Process monitoring failed.'
          setError(message)
          setCollecting(false)
          if (!canRetryMonitoring(message, responseStatus)) { setRunning(false); setRetrying(false); return }
          setRetrying(true)
          await waitForMonitoringRetry(monitoringRetryDelay(attempts++), abort.signal)
          previousArrival = null
          firstSample = true
          setArrivalInterval(null)
        }
      }
    }
    void monitor()
    return () => abort.abort()
  }, [running, host, port, username, password, interval])

  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 500)
    return () => clearInterval(timer)
  }, [])
  const { age, stale } = processFreshness(receivedAt, now, interval, completionDelay)

  return <>
    <div className="live-tabs"><button className="period-button" onClick={() => setRunning(value => !value)}>{running ? <Pause size={16} /> : <Play size={16} />}{running ? 'Pause updates' : 'Resume updates'}</button><span role="status">{!running ? 'Updates paused' : retrying ? 'Connection interrupted - reconnecting automatically' : collecting ? 'Connecting and collecting a fresh sample...' : stale ? 'Delayed — data is stale' : updated === null ? 'Connecting and collecting sample…' : `Live SSH stream · ${interval}-second CPU samples`}{age !== null ? ` · Sample age ${age.toFixed(1)}s` : ''}</span></div>
    <label className="field-label" htmlFor="sample-interval">Sampling interval <select id="sample-interval" value={interval} onChange={event => setIntervalSeconds(Number(event.target.value))}>{[1, 2, 3, 5].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
    <p className="connection-hint">Requested interval: {interval}s. Last observed arrival interval: {arrivalInterval === null ? 'waiting for two samples' : `${arrivalInterval.toFixed(2)}s`}. Server scheduling and network delays can increase the observed interval.</p>
    <p className="connection-hint">Compare with <code>top -d {interval} -o %CPU</code> in the VM. CPU uses top's per-core scale (a multithreaded process can exceed 100%). Memory is resident RAM as a percentage of VM memory. Separately running task managers may sample at different times or use a different CPU scale.</p>
    {error && <p className="live-error" role="alert">{error} {retrying ? 'Reconnecting automatically; displayed results are stale.' : 'Updates stopped; displayed results are stale. Resume to retry.'}</p>}
    <PerformancePanel samples={samples} status={retrying ? 'Reconnecting - stale data' : error ? 'Stopped · stale data' : !running ? 'Paused' : collecting ? 'Collecting a fresh sample' : stale ? 'Delayed · stale data' : 'Live'} />
    <section className="panel"><div className="panel-header"><h2>Processes</h2>{running && <RefreshCw size={16} className="spin" aria-label="Automatic updates active" />}</div><pre className="live-output">{output || (running ? 'Collecting a fresh CPU sample from the VM…' : 'No sample collected.')}</pre></section>
  </>
}
