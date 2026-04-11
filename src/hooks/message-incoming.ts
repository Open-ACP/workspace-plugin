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
      const { channelId, userId, text, meta, userDisplayName, userUsername } = payload as any

      // Build identityId and ensure user record exists.
      // Merge display name and username from the channel adapter if available — this lets
      // the registry stay current without requiring /whoami for every user.
      const source = (channelId === 'sse' || channelId === 'api') ? 'api' : channelId
      const identityId = UR.buildIdentityId(source, userId)
      const user = await registry.upsert({
        identityId,
        source,
        // Only include if the adapter provided them — avoids overwriting a manually-set
        // /whoami name with undefined when the channel doesn't supply display info.
        ...(userDisplayName !== undefined && { displayName: userDisplayName }),
        ...(userUsername !== undefined && { username: userUsername }),
      })

      ctx.log.info(`workspace: message:incoming — sender=${identityId} displayName=${user.displayName ?? userId} hasMeta=${!!meta}`)

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
