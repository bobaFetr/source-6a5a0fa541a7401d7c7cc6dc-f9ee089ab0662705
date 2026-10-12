export type HealthEvent = { id: string; at: number; message: string; unit: string; kind: 'Crash' | 'OOM' | 'Lockup' }
export type HealthSnapshot = {
  cpu: number | null; memory: number | null; memoryAvailable: number | null; memoryTotal: number | null
  memoryPressure: number | null; disk: number | null; failedServices: string[] | null
  updates: number | null; securityUpdates: number | null; cacheAt: number | null; reboot: boolean | null
  events: HealthEvent[]; journalAvailable: boolean; journalRestricted: boolean
  sampledAt: number; durationMs: number
}

export function parseHealth(output: string, sampledAt: number, durationMs: number): HealthSnapshot {
  const sections: Record<string, string[]> = {}
  let name = ''
  for (const line of output.split(/\r?\n/)) {
    if (/^@@[a-z_]+$/.test(line)) { name = line.slice(2); sections[name] = [] }
    else if (name) sections[name].push(line)
  }
  const section = (key: string) => sections[key]?.join('\n') ?? ''
  const ok = (key: string) => section(`${key}_status`).trim() === '0'
  const cpu = (key: string) => {
    const line = section(key).trim()
    if (!/^cpu\s+\d+(?:\s+\d+){7,}/.test(line)) return null
    const values = line.split(/\s+/).slice(1, 9).map(Number)
    return values.every(Number.isSafeInteger) ? values : null
  }
  const before = cpu('cpu_before'), after = cpu('cpu_after')
  let cpuUsage: number | null = null
  if (before && after) {
    const delta = after.map((value, i) => value - before[i])
    const total = delta.reduce((a, b) => a + b, 0)
    if (total > 0 && delta.every(value => value >= 0)) cpuUsage = (delta[0] + delta[1] + delta[2] + delta[5] + delta[6]) / total * 100
  }
  const memoryValue = (key: string) => {
    const value = section('memory').match(new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm'))?.[1]
    return value === undefined ? null : Number(value) * 1024
  }
  const total = memoryValue('MemTotal'), available = memoryValue('MemAvailable')
  const pressureValue = section('pressure').match(/^some avg10=(\d+(?:\.\d+)?)/m)?.[1]
  const pressure = pressureValue === undefined ? null : Number(pressureValue)
  const diskLine = section('disk').split('\n').find(line => /\s\d+%\s+\/$/.test(line))
  const diskValue = diskLine?.match(/\s(\d+)%\s+\/$/)?.[1]
  const packages = section('updates').split('\n').filter(line => /^[^\s/]+\/[^\s]+\s/.test(line))
  const cacheAt = Number(section('cache').trim()) * 1000
  const events: HealthEvent[] = []
  for (const line of sections.journal ?? []) {
    try {
      const entry = JSON.parse(line)
      if (typeof entry.MESSAGE !== 'string') continue
      const message = entry.MESSAGE.slice(0, 2000)
      const kind = /out of memory|oom-kill|killed process/i.test(message) ? 'OOM' : /soft lockup|hard LOCKUP/i.test(message) ? 'Lockup' : /segfault|core dumped|dumped core|kernel panic|status=.*(SEGV|ABRT)/i.test(message) ? 'Crash' : null
      const at = Number(entry.__REALTIME_TIMESTAMP) / 1000
      if (!kind || !Number.isFinite(at) || at <= 0 || typeof entry.__CURSOR !== 'string') continue
      events.push({ id: entry.__CURSOR.slice(0, 500), at, message, unit: typeof entry._SYSTEMD_UNIT === 'string' ? entry._SYSTEMD_UNIT : typeof entry.SYSLOG_IDENTIFIER === 'string' ? entry.SYSLOG_IDENTIFIER : 'kernel', kind })
    } catch { /* Diagnostic lines are not journal records. */ }
  }
  return {
    cpu: cpuUsage, memory: total !== null && total > 0 && available !== null && available <= total ? (1 - available / total) * 100 : null,
    memoryAvailable: available, memoryTotal: total, memoryPressure: pressure !== null && pressure >= 0 && pressure <= 100 ? pressure : null,
    disk: ok('disk') && diskValue !== undefined && Number(diskValue) <= 100 ? Number(diskValue) : null,
    failedServices: ok('services') ? (sections.services ?? []).map(line => line.trim().split(/\s+/)[0]).filter(value => /^[a-zA-Z0-9_.@:\\-]+\.service$/.test(value)).slice(0, 100) : null,
    updates: ok('updates') ? packages.length : null,
    securityUpdates: ok('updates') ? packages.filter(line => /(?:^|[ ,])[^\s,]*-security(?:[,\s]|$)/.test(line)).length : null,
    cacheAt: Number.isFinite(cacheAt) && cacheAt > 0 ? cacheAt : null,
    reboot: section('reboot').trim() === 'yes' ? true : section('reboot').trim() === 'no' ? false : null,
    events, journalAvailable: ok('journal'), journalRestricted: /not seeing messages from other users|permission denied|No journal files/i.test(section('journal')),
    sampledAt, durationMs,
  }
}

export type AlertCondition = { key: string; domain: string; title: string; detail: string; severity: 'warning' | 'critical' | 'info'; sustainMs: number }
export type Incident = AlertCondition & { id: string; firstAt: number; lastAt: number; resolvedAt: number | null; acknowledged: boolean; recorded: boolean }
export type AlertState = { incidents: Incident[]; pending: Record<string, { since: number; last: number }>; seenEvents: string[] }
export const emptyAlerts = (): AlertState => ({ incidents: [], pending: {}, seenEvents: [] })

export function healthConditions(snapshot: HealthSnapshot): { conditions: AlertCondition[]; known: string[] } {
  const conditions: AlertCondition[] = [], known: string[] = []
  const threshold = (domain: string, value: number | null, limit: number, title: string, sustainMs: number, detail: string) => {
    if (value === null) return
    known.push(domain)
    if (value >= limit) conditions.push({ key: domain, domain, title, detail, severity: 'warning', sustainMs })
  }
  threshold('cpu', snapshot.cpu, 90, 'Sustained high CPU', 30000, `CPU execution ${snapshot.cpu?.toFixed(1)}% (threshold 90% for 30s).`)
  threshold('memory', snapshot.memory, 90, 'Sustained high RAM use', 30000, `RAM unavailable to new workloads ${snapshot.memory?.toFixed(1)}% (threshold 90% for 30s).`)
  threshold('pressure', snapshot.memoryPressure, 10, 'Sustained memory pressure', 30000, `Memory PSI avg10 ${snapshot.memoryPressure?.toFixed(1)}% (threshold 10% for 30s).`)
  threshold('disk', snapshot.disk, 90, 'Root filesystem nearly full', 0, `Root filesystem ${snapshot.disk}% used (threshold 90%).`)
  if (snapshot.failedServices !== null) {
    known.push('service')
    for (const unit of snapshot.failedServices) conditions.push({ key: `service:${unit}`, domain: 'service', title: `Failed service: ${unit}`, detail: 'systemd reports this service as failed. Inspect Services and Events for details.', severity: 'critical', sustainMs: 0 })
  }
  if (snapshot.reboot !== null) {
    known.push('reboot')
    if (snapshot.reboot) conditions.push({ key: 'reboot', domain: 'reboot', title: 'Reboot required', detail: 'Ubuntu has created /run/reboot-required.', severity: 'info', sustainMs: 0 })
  }
  threshold('updates', snapshot.securityUpdates, 1, 'Security updates available', 0, `${snapshot.securityUpdates} security packages listed in the local APT cache. Cache may be outdated.`)
  return { conditions, known }
}

export function advanceAlerts(state: AlertState, conditions: AlertCondition[], known: string[], now: number): AlertState {
  const pending = { ...state.pending }
  const incidents = state.incidents.map(incident => ({ ...incident }))
  const keys = new Set(conditions.map(condition => condition.key))
  for (const incident of incidents) {
    if (!incident.recorded && incident.resolvedAt === null && known.includes(incident.domain) && !keys.has(incident.key)) incident.resolvedAt = now
  }
  for (const key of Object.keys(pending)) {
    if (!keys.has(key) && known.includes(key.split(':')[0])) delete pending[key]
  }
  for (const condition of conditions) {
    const previous = pending[condition.key]
    const since = previous && now - previous.last <= 30000 ? previous.since : now
    pending[condition.key] = { since, last: now }
    const active = incidents.find(incident => incident.key === condition.key && !incident.recorded && incident.resolvedAt === null)
    if (active) { active.lastAt = now; active.detail = condition.detail }
    else if (now - since >= condition.sustainMs) incidents.unshift({ ...condition, id: `${condition.key}:${now}`, firstAt: since, lastAt: now, resolvedAt: null, acknowledged: false, recorded: false })
  }
  // Never evict active incidents to make room for historical records.
  const active = incidents.filter(item => !item.recorded && item.resolvedAt === null)
  return { ...state, incidents: [...active, ...incidents.filter(item => item.recorded || item.resolvedAt !== null).slice(0, Math.max(0, 200 - active.length))], pending }
}

export function recordHealthEvents(state: AlertState, events: HealthEvent[]): AlertState {
  const existing = new Set([...state.seenEvents, ...state.incidents.map(item => item.id)])
  const fresh: Incident[] = events.filter(event => !existing.has(`journal:${event.id}`)).sort((a, b) => b.at - a.at).map(event => ({
    id: `journal:${event.id}`, key: `journal:${event.id}`, domain: 'journal', title: `${event.kind}: ${event.unit}`, detail: event.message,
    severity: 'critical', sustainMs: 0, firstAt: event.at, lastAt: event.at, resolvedAt: null, acknowledged: false, recorded: true,
  }))
  const combined = [...fresh, ...state.incidents]
  const active = combined.filter(item => !item.recorded && item.resolvedAt === null)
  return { ...state, seenEvents: [...new Set([...events.map(event => `journal:${event.id}`), ...state.seenEvents])].slice(0, 1000), incidents: [...active, ...combined.filter(item => item.recorded || item.resolvedAt !== null).slice(0, Math.max(0, 200 - active.length))] }
}
