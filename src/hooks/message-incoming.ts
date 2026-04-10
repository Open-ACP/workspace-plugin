import type { PluginContext } from '@openacp/plugin-sdk'
import type { UserRegistry } from '../identity.js'
import type { PresenceTracker } from '../presence.js'
import { UserRegistry as UR } from '../identity.js'
import { extractMentions, resolveMentions } from '../mentions.js'
import { TURN_META_SENDER_KEY, TURN_META_MENTIONS_KEY } from '../types.js'

export function registerMessageIncoming(
  ctx: PluginContext,
  registry: UserRegistry,
  presence: PresenceTracker,
): void {
  ctx.registerMiddleware('message:incoming', {
    priority: 20,
    handler: async (payload, next) => {
      const { channelId, userId, text, meta } = payload as any

      // Build identityId and ensure user record exists
      const source = (channelId === 'sse' || channelId === 'api') ? 'api' : channelId
      const identityId = UR.buildIdentityId(source, userId)
      const user = await registry.upsert({ identityId, source })

      // Attach sender to TurnMeta for downstream hooks
      if (!meta) {
        ctx.log.warn('message:incoming received without TurnMeta — sender identity will not propagate')
      }
      if (meta) {
        meta[TURN_META_SENDER_KEY] = {
          identityId,
          displayName: user.displayName ?? userId,
          username: user.username,
        }

        // Extract @mentions for downstream processing
        const usernames = extractMentions(text)
        if (usernames.length > 0) {
          const resolved = await resolveMentions(usernames, registry)
          meta[TURN_META_MENTIONS_KEY] = resolved
        }
      }

      return next()
    },
  })
}
