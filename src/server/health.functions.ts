import { createServerFn } from '@tanstack/react-start'
import { validateInput } from './ssh-input'

export const readHealth = createServerFn({ method: 'POST' })
  .inputValidator(input => validateInput({ ...(input as object), operation: 'overview' }))
  .handler(async ({ data }) => {
    const { collectHealth } = await import('./health.server')
    return collectHealth(data)
  })
