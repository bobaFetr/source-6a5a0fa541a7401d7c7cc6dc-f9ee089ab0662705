import { useState } from 'react'
import { AlertTriangle, Check, Download, Search, Trash2 } from 'lucide-react'
import type { HealthMonitor } from './useHealthMonitor'

export function AlertsView({ monitor }: { monitor: HealthMonitor }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState('all')
  const active = monitor.incidents.filter(item => !item.recorded && item.resolvedAt === null)
  const records = monitor.incidents.filter(item => {
    if (severity !== 'all' && item.severity !== severity) return false
    if (filter === 'active' && (item.recorded || item.resolvedAt !== null)) return false
    if (filter === 'unacknowledged' && item.acknowledged) return false
    if (filter === 'resolved' && item.resolvedAt === null) return false
    return `${item.title} ${item.detail}`.toLowerCase().includes(search.toLowerCase())
  }).sort((a, b) => b.lastAt - a.lastAt)
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(monitor.incidents, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'northstar-incidents.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="panel alerts-view" aria-label="Alerts and incident history">
    <div className="panel-header"><div><span className="panel-kicker">INCIDENT HISTORY</span><h2><AlertTriangle size={18} /> Alerts</h2><p>{active.length} active · {monitor.incidents.length} retained incidents</p></div><div className="live-tabs"><button className="period-button" disabled={!monitor.incidents.length} onClick={download}><Download size={15} /> Export</button><button className="period-button" disabled={!monitor.incidents.some(item => item.recorded || item.resolvedAt !== null)} onClick={() => { if (window.confirm('Clear resolved incidents and recorded crash/OOM history from this browser? Active alerts will remain.')) monitor.clearHistory() }}><Trash2 size={15} /> Clear history</button></div></div>
    <div className="alerts-toolbar"><label className="input-shell"><Search size={16} /><input type="search" aria-label="Search alerts" placeholder="Search incidents" value={search} onChange={event => setSearch(event.target.value)} /></label><label>Status <select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All incidents</option><option value="active">Active</option><option value="unacknowledged">Unacknowledged</option><option value="resolved">Resolved</option></select></label><label>Severity <select value={severity} onChange={event => setSeverity(event.target.value)}><option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select></label></div>
    <p role="status" className="health-footnote">{monitor.delayed ? 'Health checks are delayed; current conditions cannot be verified. Automatic recovery checks continue.' : monitor.snapshot ? 'Health checks are running across dashboard tabs.' : 'Collecting first health check.'}</p>
    {monitor.storageError && <p className="live-error" role="alert">Browser storage is unavailable. Incident history will last only for this connection.</p>}
    {records.length ? <div className="incident-list">{records.map(item => <article className={`incident ${item.severity}`} key={item.id}><div className="incident-heading"><span className={`incident-badge ${item.severity}`}>{item.severity}</span><h3>{item.title}</h3><span className="incident-status">{item.recorded ? 'Recorded event' : item.resolvedAt !== null ? 'Resolved' : 'Active'}{item.acknowledged ? ' · Acknowledged' : ''}</span></div><p>{item.detail}</p><dl><div><dt>First observed</dt><dd>{new Date(item.firstAt).toLocaleString()}</dd></div><div><dt>{item.recorded ? 'Recorded at' : 'Last observed'}</dt><dd>{new Date(item.lastAt).toLocaleString()}</dd></div>{item.resolvedAt !== null && <div><dt>Recovered</dt><dd>{new Date(item.resolvedAt).toLocaleString()}</dd></div>}</dl><button className="period-button" disabled={item.acknowledged} onClick={() => monitor.acknowledge(item.id)}><Check size={15} /> {item.acknowledged ? 'Acknowledged' : 'Acknowledge'}</button></article>)}</div> : <p className="alerts-empty">{monitor.incidents.length ? 'No incidents match these filters.' : 'No incidents recorded yet. Health checks will populate this list.'}</p>}
    <p className="health-footnote">Up to 200 incidents are saved in this browser per server and user. Active alerts are retained until a fresh check confirms recovery; acknowledging an alert does not resolve it. Historical active alerts need a fresh check to verify their current state. No monitoring or notifications run after disconnecting or closing the app.</p>
  </section>
}
