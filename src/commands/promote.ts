import type { CommandDef, PluginContext } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { IdentityService } from '../types.js'
import { formatIdentityId } from '../types.js'
import { extractMentions, resolveMentions } from '../mentions.js'

export function makePromoteCommand(
  getSessionStore: (sid: string) => SessionStore,
  identity: IdentityService,
  ctx: PluginContext,
): CommandDef {
  return {
    name: 'promote',
    description: 'Transfer session ownership to another participant',
    usage: '@user',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const store = getSessionStore(args.sessionId)
      const session = await store.get()
      if (session?.type !== 'teamwork') return { type: 'error', message: 'Requires team mode.' }

      // Only the current owner can transfer ownership
      const identityId = formatIdentityId(args.channelId, args.userId)
      const caller = await identity.getUserByIdentity(identityId)
      if (!caller || caller.userId !== session.owner) {
        return { type: 'error', message: 'Only the session owner can transfer ownership.' }
      }

      const mentions = extractMentions(args.raw)
      if (mentions.length === 0) return { type: 'error', message: 'Usage: /promote @user' }

      const [newOwnerUserId] = await resolveMentions(mentions, identity)
      if (!newOwnerUserId) return { type: 'error', message: `User @${mentions[0]} not found.` }

      const isParticipant = session.participants.some(p => p.userId === newOwnerUserId)
      if (!isParticipant) {
        const user = await identity.getUser(newOwnerUserId)
        return { type: 'error', message: `${user?.displayName ?? newOwnerUserId} is not a participant in this session.` }
      }

      await store.transferOwnership(newOwnerUserId)
      const user = await identity.getUser(newOwnerUserId)
      const name = user?.displayName ?? newOwnerUserId

      await ctx.emitHook('promote', { sessionId: args.sessionId, from: caller.userId, to: newOwnerUserId })

      return { type: 'text', text: `✅ Session ownership transferred to ${name}.` }
    },
  }
}
