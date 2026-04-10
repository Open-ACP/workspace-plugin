import type { PluginContext } from '@openacp/plugin-sdk'
import type { UserRegistry } from '../identity.js'
import { extractMentions, resolveMentions } from '../mentions.js'

export function registerAgentAfterTurn(
  ctx: PluginContext,
  registry: UserRegistry,
  isTeamworkSession: (sessionId: string) => Promise<boolean>,
): void {
  ctx.registerMiddleware('agent:afterTurn', {
    handler: async (payload, next) => {
      const { sessionId, fullText, turnId } = payload as any
      if (!await isTeamworkSession(sessionId)) return next()

      const usernames = extractMentions(fullText)
      if (usernames.length === 0) return next()

      const mentionedIds = await resolveMentions(usernames, registry)
      for (const mentionedId of mentionedIds) {
        const user = await registry.getById(mentionedId)
        await ctx.sendMessage(sessionId, {
          type: 'text' as const,
          text: `🤖 The agent mentioned @${user?.username ?? mentionedId}. Your input may be needed.`,
        })
      }
      return next()
    },
  })
}
