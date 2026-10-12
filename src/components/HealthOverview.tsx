import { Activity, AlertTriangle, CheckCircle2, Cpu, Database, HardDrive, HeartPulse, RefreshCw, ShieldCheck, Timer } from 'lucide-react'
import type { HealthMonitor } from './useHealthMonitor'

const percent = (value: number | null | undefined) => value === null || value === undefined ? 'Unavailable' : `${value.toFixed(1)}%`
const gib = (value: number | null | undefined) => value === null || value === undefined ? 'Unavailable' : `${(value / 1024 ** 3).toFixed(2)} GiB`

export function HealthOverview({ monitor, openAlerts, openProcesses, openEvents }: { monitor: HealthMonitor; openAlerts: () => void; openProcesses: () => void; openEvents: () => void }) {
  const { snapshot: data, busy, error, age, delayed, incidents } = monitor
  const active = incidents.filter(item => !item.recorded && item.resolvedAt === null)
  const recorded = incidents.filter(item => item.recorded && !item.acknowledged).length
  const unknown = !data || data.cpu === null || data.memory === null || data.memoryPressure === null || data.disk === null || data.failedServices === null || data.updates === null || data.reboot === null || !data.journalAvailable || data.journalRestricted
  const status = delayed ? 'Health data delayed' : !data ? 'Collecting first health check' : active.length ? 'Needs attention' : recorded ? 'Recorded incidents need review' : unknown ? 'Some checks unavailable' : 'No current threshold alerts'
  return <section className="health-overview" aria-label="Server health overview">
    <div className={`panel health-banner ${delayed || active.length || recorded ? 'attention' : ''}`}>
      <HeartPulse size={30} /><div><span className="panel-kicker">SERVER HEALTH</span><h2>{status}</h2><p>{age === null ? 'Waiting for a successful SSH health check.' : `Reading age ${age.toFixed(0)}s. ${busy ? 'Collecting the next reading...' : 'Checks repeat 10 seconds after completion.'}`}</p></div>
      <button className="period-button" onClick={monitor.refresh} disabled={busy}><RefreshCw size={16} className={busy ? 'spin' : ''} /> Check now</button>
    </div>
    {error && <p role="alert" className="live-error">{error} Health checks retry automatically. Previous readings remain historical.</p>}
    <div className="health-grid">
      <article className="panel health-card"><Cpu size={20} /><h3>CPU execution</h3><strong>{percent(data?.cpu)}</strong><p>90% or higher for 30 seconds raises an alert. Excludes I/O wait and VM steal time.</p><button className="health-link" onClick={openProcesses}>Inspect processes</button></article>
      <article className="panel health-card"><Database size={20} /><h3>RAM pressure</h3><strong>{percent(data?.memory)}</strong><p>{gib(data?.memoryAvailable)} available / {gib(data?.memoryTotal)} total. RAM use is calculated from MemAvailable, including reclaimable cache.</p><span className="health-detail">Memory stall PSI avg10: {percent(data?.memoryPressure)}</span></article>
      <article className="panel health-card"><HardDrive size={20} /><h3>Root filesystem</h3><strong>{percent(data?.disk)}</strong><p>Alerts at 90% used. This check covers the filesystem mounted at /.</p></article>
      <article className="panel health-card"><Activity size={20} /><h3>Failed services</h3><strong>{data?.failedServices === null || !data ? 'Unavailable' : data.failedServices.length}</strong><p>{data?.failedServices?.length ? data.failedServices.join(', ') : data?.failedServices ? 'No failed system services in this check.' : 'Waiting for systemd results.'}</p><button className="health-link" onClick={openEvents}>Inspect events</button></article>
      <article className="panel health-card"><ShieldCheck size={20} /><h3>Pending updates</h3><strong>{data?.updates ?? 'Unavailable'}</strong><p>{data?.securityUpdates ?? 'Unknown'} security updates according to the local APT cache.</p><span className="health-detail">Cache directory changed: {data?.cacheAt ? new Date(data.cacheAt).toLocaleString() : 'Unavailable'}. Package lists are not refreshed by this check.</span></article>
      <article className="panel health-card"><Timer size={20} /><h3>Reboot status</h3><strong className="health-word">{data?.reboot === true ? 'Required' : data?.reboot === false ? 'Not requested' : 'Unavailable'}</strong><p>Based on Ubuntu's reboot-required marker.</p></article>
    </div>
    <section className="panel health-alert-summary"><div className="panel-header"><h2><AlertTriangle size={18} /> Alerts and incidents</h2><button className="period-button" onClick={openAlerts}>View all alerts</button></div>
      <p>{active.length} active alerts · {recorded} unacknowledged crash/OOM/lockup records</p>
      {active.slice(0, 4).map(item => <button key={item.id} className="health-summary-row" onClick={openAlerts}><AlertTriangle size={16} /><span>{item.title}</span><span className={`incident-badge ${item.severity}`}>{item.severity}</span></button>)}
      {!active.length && data && !delayed && <p className="health-clear"><CheckCircle2 size={16} /> No active threshold alerts from available checks.</p>}
    </section>
    <p className="health-footnote">Read-only checks run across dashboard tabs while connected. Sustained alerts require successive observations without a gap over 30 seconds. Crash/OOM detection examines the latest 100 accessible journal records; missing or inaccessible records do not prove the absence of a crash. {data?.journalRestricted ? 'Your user has restricted access to the system journal.' : !data?.journalAvailable ? 'Journal check is unavailable.' : ''}</p>
  </section>
}
