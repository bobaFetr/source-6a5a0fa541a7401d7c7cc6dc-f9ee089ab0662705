import { FileExplorer } from './FileExplorer'
import { useState } from 'react'
import { Command, LogOut, RefreshCw, Server } from 'lucide-react'
import { runSsh } from '../server/ssh.functions'
import { type Coordinates, type Operation } from '../server/ssh-input'
import { ProcessMonitor } from './ProcessMonitor'
import { SshTerminal } from './SshTerminal'
import { DiskUsageAnalyzer } from './DiskUsageAnalyzer'
import { HealthOverview } from './HealthOverview'
import { AlertsView } from './AlertsView'
import { useHealthMonitor } from './useHealthMonitor'

const views = { overview: 'Overview', alerts: 'Alerts', terminal: 'Terminal', files: 'File Explorer', programs: 'Programs', processes: 'Processes', containers: 'Containers', storage: 'Storage', services: 'Services', logs: 'Logs', events: 'Events' } as const

export function LiveDashboard({ coordinates, initialOutput, disconnect }: { coordinates: Coordinates; initialOutput: string; disconnect: () => void }) {
  const health = useHealthMonitor(coordinates)
  const alertCount = health.incidents.filter(item => item.recorded ? !item.acknowledged : item.resolvedAt === null).length
  const [view, setView] = useState<keyof typeof views>('overview')
  const [output, setOutput] = useState(initialOutput)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState<string | null>(() => new Date().toLocaleTimeString())
  const [container, setContainer] = useState('')
  const [notice, setNotice] = useState('')
  const [logSearch, setLogSearch] = useState('')
  const isDiagnostics = view === 'logs' || view === 'events'
  const visibleOutput = isDiagnostics && logSearch.trim() ? output.split(/\r?\n/).filter(line => line.toLowerCase().includes(logSearch.trim().toLowerCase())).join('\n') : output
  const [overviewRefresh, setOverviewRefresh] = useState(0)
  async function run(operation: Operation) {
    if (busy) return
    if (['start', 'stop', 'restart'].includes(operation) && !window.confirm(`${operation} container ${container} on ${coordinates.host}?`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await runSsh({ data: { ...coordinates, operation, container } })
      if (!result.ok) { setError(result.output); return }
      if (operation === 'start' || operation === 'stop' || operation === 'restart') {
        setNotice(`Container ${operation} completed.`)
        const refreshed = await runSsh({ data: { ...coordinates, operation: 'containers' } })
        if (!refreshed.ok) { setError(refreshed.output); return }
        setOutput(refreshed.output)
      } else setOutput(result.output)
      setUpdated(new Date().toLocaleTimeString())
      if (operation === 'overview') setOverviewRefresh(value => value + 1)
    } catch (e) { setError(e instanceof Error ? e.message : 'Request failed.') }
    finally { setBusy(false) }
  }
  function selectView(id: keyof typeof views) {
    if (id === view) return
    setView(id); setLogSearch(''); setOutput(''); setUpdated(null); setError(''); setNotice('')
    if (id !== 'processes' && id !== 'terminal' && id !== 'files' && id !== 'alerts') void run(id)
  }
  return <main className="live-shell">
    <header className="connection-header"><div className="brand-lockup"><div className="brand-mark"><Command size={19} /></div><div><strong>Northstar</strong><span>Ubuntu control</span></div></div><button className="period-button" disabled={busy} onClick={disconnect}><LogOut size={16} /> Disconnect</button></header>
    <section className="dashboard-content">
      <div className="page-heading"><div><div className="eyebrow"><Server size={16} /> Live SSH operations</div><h1>{coordinates.host}</h1><p>{coordinates.username} · Port {coordinates.port} · Password authenticated</p></div><button className="primary-action" disabled={busy || (view === 'alerts' && health.busy) || (view === 'processes' || view === 'terminal' || view === 'files')} onClick={() => { if (view === 'alerts') health.refresh(); else if (view !== 'terminal' && view !== 'files') { void run(view); if (view === 'overview') health.refresh() } }}><RefreshCw size={16} className={busy ? 'spin' : ''} /> {busy ? 'Working…' : 'Refresh'}</button></div>
      <nav className="live-tabs" aria-label="Live server tools">{Object.entries(views).map(([id, label]) => <button className={view === id ? 'primary-action' : 'period-button'} disabled={busy} aria-current={view === id ? 'page' : undefined} key={id} onClick={() => selectView(id as keyof typeof views)}>{label}{id === 'alerts' && alertCount > 0 ? ` (${alertCount})` : ''}</button>)}</nav>
      {error && <p role="alert" className="live-error">{error} Previous results may be stale.</p>}
      {notice && <p role="status">{notice}</p>}
      {view === 'overview' && <HealthOverview monitor={health} openAlerts={() => selectView('alerts')} openProcesses={() => selectView('processes')} openEvents={() => selectView('events')} />}
      {view === 'overview' && <DiskUsageAnalyzer coordinates={coordinates} refreshKey={overviewRefresh} />}
      {isDiagnostics && <section className="panel diagnostics-controls"><label htmlFor="log-search">Search {views[view]} results</label><div className="input-shell"><input id="log-search" type="search" value={logSearch} onChange={event => setLogSearch(event.target.value)} placeholder="Service, message, or timestamp" /></div><p>{view === 'logs' ? 'Latest 300 journal entries, with timestamps. Refresh to read new records.' : 'Current failed services, warnings/errors and crash signals from the last 24 hours, plus recorded core dumps. Journal results are capped; crashes appear only if the server recorded them.'} Only records accessible to your SSH user are shown. An empty result does not prove the server is healthy.</p></section>}
      {view === 'programs' && <p className="connection-hint">Installed APT/DPKG packages include applications, libraries, and system tools. Snap and Flatpak packages are included when available. Manually copied programs and software installed through language-specific package managers are not included. Use Refresh to update the list.</p>}
      {view === 'alerts' ? <AlertsView monitor={health} /> : view === 'files' ? <FileExplorer coordinates={coordinates} /> : view === 'terminal' ? <SshTerminal coordinates={coordinates} /> : view === 'processes' ? <ProcessMonitor coordinates={coordinates} /> : <section className="panel"><div className="panel-header"><h2>{views[view]}</h2><span>{busy ? 'Loading…' : updated ? `Last successful update: ${updated}` : 'Not loaded yet'}</span></div><pre className="live-output" aria-busy={busy}>{visibleOutput || (isDiagnostics && logSearch.trim() && output ? 'No matching records.' : busy ? 'Reading server…' : 'No data available.')}</pre></section>}
      {view === 'containers' && <section className="panel live-controls"><label htmlFor="container-id">Container ID from the list above</label><div className="input-shell"><input disabled={busy} id="container-id" value={container} onChange={e => setContainer(e.target.value.trim())} placeholder="12-character container ID" /></div><div className="live-tabs">{(['start', 'stop', 'restart'] as const).map(action => <button key={action} className="period-button" disabled={busy || !/^[a-f0-9]{12,64}$/.test(container)} onClick={() => void run(action)}>{action}</button>)}</div><p>Your Ubuntu user must already have permission to access Docker.</p></section>}
      <p className="connection-hint">Processes stream through one SSH connection at the selected sampling interval. Health checks repeat across tabs while connected. Other views refresh on demand. The Terminal opens an interactive Ubuntu shell. File Explorer browses the server through SFTP. Dedicated firewall and package-management views are not implemented.</p>
    </section>
  </main>
}
