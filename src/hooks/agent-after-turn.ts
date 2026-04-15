import type { PluginContext } from '@openacp/plugin-sdk'
import type { IdentityService } from '../types.js'
import { extractMentions, resolveMentions, extractMentionContext } from '../mentions.js'

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
      // ctx.notify exists on PluginContext but SDK types lag behind — cast through any
      const notify = (ctx as any).notify?.bind(ctx) as
        | ((t: any, m: any, o?: any) => void)
        | undefined

      const session = (ctx as any).sessions?.getSession?.(sessionId) as
        | { name?: string }
        | undefined
      const sessionName = session?.name ?? 'Unnamed session'

      for (const mentionedUserId of mentionedUserIds) {
        const user = await identity.getUser(mentionedUserId)
        const username = user?.username ?? mentionedUserId
        const context = extractMentionContext(fullText, username, 150)

        notify?.(
          { userId: mentionedUserId },
          { type: 'text', text: `🤖 Mentioned in "${sessionName}": ${context}` },
          { sessionId, via: 'topic' },
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
