import type { PluginContext } from '@openacp/plugin-sdk'
import type { IdentityService } from '../types.js'
import { extractMentions, resolveMentions } from '../mentions.js'

export function registerAgentAfterTurn(
  ctx: PluginContext,
  identity: IdentityService,
  isTeamworkSession: (sessionId: string) => Promise<boolean>,
): void {
  ctx.registerMiddleware('agent:afterTurn', {
    handler: async (payload, next) => {
      const { sessionId, fullText, turnId } = payload as any
      if (!await isTeamworkSession(sessionId)) return next()

      const usernames = extractMentions(fullText)
      if (usernames.length === 0) return next()

      const mentionedUserIds = await resolveMentions(usernames, identity)
      const notify = (ctx as any).notify?.bind(ctx) as ((t: any, m: any, o?: any) => void) | undefined
      for (const mentionedUserId of mentionedUserIds) {
        const user = await identity.getUser(mentionedUserId)
        notify?.(
          { userId: mentionedUserId },
          { type: 'text', text: `🤖 The agent mentioned @${user?.username ?? mentionedUserId}. Your input may be needed.` },
          { via: 'dm' },
        )
        await ctx.emitHook('mention', {
          sessionId,
          turnId,
          mentionedBy: 'agent',
          mentionedUser: mentionedUserId,
        })
      }
      return next()
    },
  })
}
