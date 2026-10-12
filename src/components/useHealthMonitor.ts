import { useEffect, useRef, useState } from 'react'
import { readHealth } from '../server/health.functions'
import type { Coordinates } from '../server/ssh-input'
import { advanceAlerts, emptyAlerts, healthConditions, recordHealthEvents, type AlertState, type HealthSnapshot, type Incident } from '../lib/health'

function loadHistory(key: string): AlertState {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (!saved || !Array.isArray(saved.incidents)) return emptyAlerts()
    const incidents = saved.incidents.slice(0, 200).filter((item: unknown): item is Incident => {
      if (!item || typeof item !== 'object') return false
      const value = item as Incident
      return typeof value.id === 'string' && typeof value.key === 'string' && typeof value.domain === 'string' && typeof value.title === 'string' && typeof value.detail === 'string' && ['warning', 'critical', 'info'].includes(value.severity) && typeof value.firstAt === 'number' && Number.isFinite(value.firstAt) && typeof value.lastAt === 'number' && Number.isFinite(value.lastAt) && (value.resolvedAt === null || typeof value.resolvedAt === 'number') && typeof value.acknowledged === 'boolean' && typeof value.recorded === 'boolean'
    })
    const seenEvents = Array.isArray(saved.seenEvents) ? saved.seenEvents.filter((id: unknown) => typeof id === 'string' && id.length <= 510).slice(0, 1000) : []
    return { incidents, seenEvents, pending: {} }
  } catch { return emptyAlerts() }
}

export function useHealthMonitor(coordinates: Coordinates) {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [age, setAge] = useState<number | null>(null)
  const [delayed, setDelayed] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const state = useRef<AlertState>(emptyAlerts())
  const refresh = useRef<() => void>(() => {})
  const storageKey = `northstar:incidents:v1:${coordinates.host}:${coordinates.port}:${coordinates.username}`
  const { host, port, username, password } = coordinates

  const save = (next: AlertState) => {
    state.current = next
    setIncidents(next.incidents)
    try { localStorage.setItem(storageKey, JSON.stringify({ incidents: next.incidents, seenEvents: next.seenEvents })); setStorageError(false) }
    catch { setStorageError(true) }
  }

  useEffect(() => {
    const abort = new AbortController()
    let mounted = true, inFlight = false
    let nextCheck: ReturnType<typeof setTimeout> | undefined
    let lastReceived: number | null = null, collectionDelay = 0
    let failure = ''
    const started = performance.now()
    state.current = loadHistory(storageKey)
    setIncidents(state.current.incidents)
    setSnapshot(null)
    setAge(null)
    setDelayed(false)

    async function check() {
      if (inFlight || !mounted) return
      clearTimeout(nextCheck)
      inFlight = true; setBusy(true)
      try {
        const result = await readHealth({ data: { host, port, username, password }, signal: abort.signal })
        if (!mounted) return
        if (!result.ok) throw new Error(result.error)
        const value = result.snapshot
        lastReceived = performance.now(); collectionDelay = value.durationMs
        failure = ''; setError(''); setSnapshot(value)
        // Slow checks are historical readings, not proof of current recovery.
        if (value.durationMs <= 25000) {
          const { conditions, known } = healthConditions(value)
          save(recordHealthEvents(advanceAlerts(state.current, conditions, known, Date.now()), value.events))
        } else save(recordHealthEvents(state.current, value.events))
      } catch (cause) {
        if (!mounted) return
        failure = cause instanceof Error ? cause.message : 'Health check failed.'
        setError(failure)
      } finally {
        inFlight = false
        if (mounted) { setBusy(false); nextCheck = setTimeout(() => void check(), 10000) }
      }
    }
    refresh.current = () => void check()
    const timer = setInterval(() => {
      if (!mounted) return
      const ageMs = lastReceived === null ? null : performance.now() - lastReceived + collectionDelay
      const stale = !!failure || (ageMs === null ? performance.now() - started > 25000 : ageMs > 25000)
      setAge(ageMs === null ? null : ageMs / 1000); setDelayed(stale)
      const existing = state.current.incidents.some(item => item.domain === 'connection' && item.resolvedAt === null)
      if (stale || existing) {
        const conditions = stale ? [{ key: 'connection', domain: 'connection', severity: 'warning' as const, sustainMs: 0, title: failure ? 'SSH health check failed' : 'Health data delayed', detail: failure || `No fresh health reading within 25 seconds. Last reading age: ${ageMs === null ? 'no successful sample yet' : `${Math.round(ageMs / 1000)}s`}. VM scheduling, memory pressure, or network delays may prevent collection. Checks continue automatically.` }] : []
        save(advanceAlerts(state.current, conditions, ['connection'], Date.now()))
      }
    }, 1000)
    void check()
    return () => { mounted = false; abort.abort(); clearInterval(timer); clearTimeout(nextCheck); refresh.current = () => {} }
  }, [host, port, username, password, storageKey])

  return {
    snapshot, incidents, busy, error, age, delayed, storageError,
    refresh: () => refresh.current(),
    acknowledge: (id: string) => save({ ...state.current, incidents: state.current.incidents.map(item => item.id === id ? { ...item, acknowledged: true } : item) }),
    clearHistory: () => save({ ...state.current, incidents: state.current.incidents.filter(item => !item.recorded && item.resolvedAt === null) }),
  }
}

export type HealthMonitor = ReturnType<typeof useHealthMonitor>
