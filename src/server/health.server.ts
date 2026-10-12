import { getRequest } from '@tanstack/react-start/server'
import { assertLocalRequest } from './local-request'
import { trustedHostKeys } from './known-hosts'
import { passwordSsh } from './password-ssh'
import { healthCommand } from './health-command'
import { parseHealth, type HealthSnapshot } from '../lib/health'
import type { Coordinates } from './ssh-input'

let active = 0
export async function collectHealth(data: Coordinates): Promise<{ ok: true; snapshot: HealthSnapshot } | { ok: false; error: string }> {
  assertLocalRequest(getRequest(), import.meta.env.DEV)
  if (active >= 2) return { ok: false, error: 'Health checks are busy. Retrying shortly.' }
  active++
  const started = performance.now()
  const sampledAt = Date.now()
  try {
    const result = await passwordSsh(data, healthCommand, await trustedHostKeys(data.host, data.port), 90000, getRequest().signal)
    if (!result.ok) return { ok: false, error: result.output }
    return { ok: true, snapshot: parseHealth(result.output, sampledAt, performance.now() - started) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Health check failed.' }
  } finally { active-- }
}
