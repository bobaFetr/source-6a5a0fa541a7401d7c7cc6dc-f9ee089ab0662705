import test from 'node:test'
import assert from 'node:assert/strict'
import { monitoringRetryDelay, canRetryMonitoring, waitForMonitoringRetry } from '../src/components/process-retry.ts'

test('monitor retries transient failures with bounded exponential backoff', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 20].map(monitoringRetryDelay), [1000, 2000, 4000, 8000, 10000, 10000])
  for (const message of ['SSH monitoring connection closed.', 'Process monitoring timed out.', 'Failed to fetch']) assert.equal(canRetryMonitoring(message), true)
  assert.equal(canRetryMonitoring('Busy', 429), true)
  assert.equal(canRetryMonitoring('Server error', 503), true)
  assert.equal(canRetryMonitoring('Forbidden', 403), false)
  for (const message of ['Authentication failed.', 'VM host key verification failed.', 'Invalid process monitoring response.', 'Check that top (procps) is installed.']) assert.equal(canRetryMonitoring(message), false)
})

test('pause or unmount cancels a pending reconnect immediately', async () => {
  const abort = new AbortController()
  const pending = waitForMonitoringRetry(10000, abort.signal)
  abort.abort()
  await pending
  await waitForMonitoringRetry(10000, abort.signal)
})
