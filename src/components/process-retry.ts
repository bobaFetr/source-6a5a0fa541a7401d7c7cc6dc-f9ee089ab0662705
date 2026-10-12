export function monitoringRetryDelay(attempt: number) {
  return Math.min(10000, 1000 * 2 ** Math.min(attempt, 4))
}

export function canRetryMonitoring(message: string, status?: number) {
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return false
  return !/authentication|host key|refused|invalid|unsupported|size limit|only local|check that top/i.test(message)
}

export function waitForMonitoringRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, delay)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}
