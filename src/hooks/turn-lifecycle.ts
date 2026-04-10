import type { PluginContext } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { PresenceTracker } from '../presence.js'
import { TURN_META_SENDER_KEY, type WorkspaceTurnSender } from '../types.js'

export function registerTurnLifecycle(
  ctx: PluginContext,
  getSessionStore: (sessionId: string) => SessionStore,
  presence: PresenceTracker,
): void {
  ctx.registerMiddleware('turn:start', {
    handler: async (payload, next) => {
      const { sessionId, meta } = payload as any
      const sender = meta?.[TURN_META_SENDER_KEY] as WorkspaceTurnSender | undefined
      if (sender) {
        const store = getSessionStore(sessionId)
        await store.updatePresence(sender.identityId, 'active')
        presence.markActive(store, sessionId, sender.identityId)
      }
      return next()
    },
  })
}
