import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { healthCommand } from '../src/server/health-command.ts'
import { parseHealth, healthConditions, advanceAlerts, emptyAlerts, recordHealthEvents } from '../src/lib/health.ts'

const fixture = `@@cpu_before
cpu 100 0 100 800 0 0 0 0 0 0
@@cpu_after
cpu 140 0 110 850 0 0 0 0 0 0
@@memory
MemTotal:       1000 kB
MemAvailable:   250 kB
@@pressure
some avg10=12.34 avg60=0.00 avg300=0.00 total=123
@@disk
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/sda1 1000 950 50 95% /
@@disk_status
0
@@services
example.service loaded failed failed Example service
@@services_status
0
@@updates
Listing...
app/noble-security,noble-updates 1.2 amd64 [upgradable from: 1.1]
other/noble-updates 2 amd64 [upgradable from: 1]
@@updates_status
0
@@cache
1700000000
@@reboot
yes
@@journal
{"__CURSOR":"abc","__REALTIME_TIMESTAMP":"1700000000000000","MESSAGE":"Killed process 1 (test) out of memory","_SYSTEMD_UNIT":"test.service"}
{"__CURSOR":"def","__REALTIME_TIMESTAMP":"1700000000000000","MESSAGE":"NMI watchdog permanently disabled"}
@@journal_status
0
`

test('health parses CPU interval counters, reclaimable RAM, root disk, APT cache and crash evidence', () => {
  const data = parseHealth(fixture, 100000, 1200)
  assert.equal(data.cpu, 50)
  assert.equal(data.memory, 75)
  assert.equal(data.memoryTotal, 1024000)
  assert.equal(data.memoryPressure, 12.34)
  assert.equal(data.disk, 95)
  assert.deepEqual(data.failedServices, ['example.service'])
  assert.equal(data.updates, 2)
  assert.equal(data.securityUpdates, 1)
  assert.equal(data.cacheAt, 1700000000000)
  assert.equal(data.reboot, true)
  assert.equal(data.events.length, 1)
  assert.equal(data.events[0].kind, 'OOM')
})

test('missing or failed health checks remain unavailable instead of healthy zero', () => {
  const empty = parseHealth('', 100000, 10)
  assert.equal(empty.cpu, null)
  assert.equal(empty.memory, null)
  assert.equal(empty.disk, null)
  assert.equal(empty.failedServices, null)
  assert.equal(empty.updates, null)
  assert.equal(empty.reboot, null)
  assert.equal(empty.journalAvailable, false)
  assert.deepEqual(healthConditions(empty).known, [])
  const invalid = parseHealth(fixture.replace('@@services_status\n0', '@@services_status\n1').replace('@@updates_status\n0', '@@updates_status\n1').replace('250 kB', '2000 kB'), 100000, 10)
  assert.equal(invalid.failedServices, null)
  assert.equal(invalid.updates, null)
  assert.equal(invalid.memory, null)
})

test('read-only health command preserves failure status per section', { skip: !existsSync('C:/Program Files/Git/bin/bash.exe') && process.platform === 'win32' }, () => {
  const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh'
  const result = spawnSync(shell, ['-c', `
sleep() { :; }
systemctl() { printf 'Permission denied\\n'; return 1; }
apt() { printf 'Database unavailable\\n'; return 1; }
journalctl() { printf 'Permission denied\\n'; return 1; }
${healthCommand}`], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0)
  const data = parseHealth(result.stdout, 100000, 100)
  assert.equal(data.failedServices, null)
  assert.equal(data.updates, null)
  assert.equal(data.journalAvailable, false)
  assert.equal(data.journalRestricted, true)
})

const condition = { key: 'cpu', domain: 'cpu', title: 'CPU', detail: 'high', severity: 'warning', sustainMs: 30000 }
test('sustained alerts debounce, deduplicate, retain acknowledgement and recover only from known checks', () => {
  let state = advanceAlerts(emptyAlerts(), [condition], ['cpu'], 1000)
  state = advanceAlerts(state, [condition], ['cpu'], 16000)
  assert.equal(state.incidents.length, 0)
  state = advanceAlerts(state, [condition], ['cpu'], 31000)
  assert.equal(state.incidents.length, 1)
  state.incidents[0].acknowledged = true
  state = advanceAlerts(state, [condition], ['cpu'], 41000)
  assert.equal(state.incidents.length, 1)
  assert.equal(state.incidents[0].acknowledged, true)
  state = advanceAlerts(state, [], [], 51000)
  assert.equal(state.incidents[0].resolvedAt, null)
  state = advanceAlerts(state, [], ['cpu'], 61000)
  assert.equal(state.incidents[0].resolvedAt, 61000)
  state = advanceAlerts(state, [condition], ['cpu'], 71000)
  state = advanceAlerts(state, [condition], ['cpu'], 86000)
  state = advanceAlerts(state, [condition], ['cpu'], 101000)
  assert.equal(state.incidents.length, 2)
  assert.equal(state.incidents[0].acknowledged, false)
})

test('long observation gaps reset pending sustained alerts', () => {
  let state = advanceAlerts(emptyAlerts(), [condition], ['cpu'], 1000)
  state = advanceAlerts(state, [condition], ['cpu'], 41000)
  assert.equal(state.incidents.length, 0)
  assert.equal(state.pending.cpu.since, 41000)
})

test('journal events are deduplicated even after clearing visible history', () => {
  const events = parseHealth(fixture, 100000, 100).events
  let state = recordHealthEvents(emptyAlerts(), events)
  assert.equal(state.incidents.length, 1)
  state = recordHealthEvents(state, events)
  assert.equal(state.incidents.length, 1)
  state = { ...state, incidents: [] }
  assert.equal(recordHealthEvents(state, events).incidents.length, 0)
})

test('kernel lockup evidence is labelled separately from a confirmed crash', () => {
  const data = parseHealth(fixture.replace('Killed process 1 (test) out of memory', 'watchdog: BUG: soft lockup - CPU#0 stuck for 42s!'), 100000, 100)
  assert.equal(data.events.length, 1)
  assert.equal(data.events[0].kind, 'Lockup')
})

test('bounded history retains active alerts before historical events', () => {
  const active = advanceAlerts(emptyAlerts(), [{ ...condition, sustainMs: 0 }], ['cpu'], 1000)
  const events = Array.from({ length: 220 }, (_, i) => ({ id: String(i), at: 2000 + i, message: 'OOM', unit: 'kernel', kind: 'OOM' }))
  const state = recordHealthEvents(active, events)
  assert.equal(state.incidents.length, 200)
  assert.equal(state.incidents[0].key, 'cpu')
  assert.equal(state.incidents[0].resolvedAt, null)
  assert.equal(state.incidents[1].firstAt, 2219, 'Newest historical evidence is retained first')
})
