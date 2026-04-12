import type { PluginContext } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { PresenceTracker } from '../presence.js'
import type { IdentitySnapshot } from '../types.js'

export function registerTurnLifecycle(
  ctx: PluginContext,
  getSessionStore: (sessionId: string) => SessionStore,
  presence: PresenceTracker,
): void {
  ctx.registerMiddleware('turn:start', {
    handler: async (payload, next) => {
      const { sessionId, meta } = payload as any
      const sender = meta?.identity as IdentitySnapshot | undefined
      if (sender) {
        const store = getSessionStore(sessionId)
        await store.updatePresence(sender.userId, 'active')
        presence.markActive(store, sessionId, sender.userId)
      }
      return next()
    },
  })
}
