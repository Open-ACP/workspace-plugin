import type { PluginContext } from '@openacp/plugin-sdk'
import type { UserRegistry } from '../identity.js'
import type { PresenceTracker } from '../presence.js'
import { UserRegistry as UR } from '../identity.js'
import { extractMentions, resolveMentions } from '../mentions.js'
import { TURN_META_CHANNEL_USER_KEY, TURN_META_SENDER_KEY, TURN_META_MENTIONS_KEY, type ChannelUserMeta } from '../types.js'

export function registerMessageIncoming(
  ctx: PluginContext,
  registry: UserRegistry,
  presence: PresenceTracker,
): void {
  ctx.registerMiddleware('message:incoming', {
    priority: 20,
    handler: async (payload, next) => {
      const { channelId, userId, text, meta } = payload as any

      // Adapters inject a structured ChannelUserMeta into TurnMeta via handleMessage(initialMeta).
      // Fall back to the raw message fields so the hook works even without adapter enrichment.
      const channelUser = meta?.[TURN_META_CHANNEL_USER_KEY] as ChannelUserMeta | undefined
      const effectiveChannelId = channelUser?.channelId ?? channelId
      const effectiveUserId = channelUser?.userId ?? userId

      // Build identityId and ensure user record exists.
      // Only merge display name/username when provided — avoids overwriting a manually-set
      // /whoami name with undefined when the adapter doesn't supply display info.
      const source = (effectiveChannelId === 'sse' || effectiveChannelId === 'api') ? 'api' : effectiveChannelId
      const identityId = UR.buildIdentityId(source, effectiveUserId)
      const user = await registry.upsert({
        identityId,
        source,
        ...(channelUser?.displayName !== undefined && { displayName: channelUser.displayName }),
        ...(channelUser?.username !== undefined && { username: channelUser.username }),
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
