import type { CommandDef, PluginContext } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { UserRegistry } from '../identity.js'
import { UserRegistry as UR } from '../identity.js'
import { extractMentions, resolveMentions } from '../mentions.js'
import type { IdentitySource } from '../types.js'

export function makeHandoffCommand(
  getSessionStore: (sid: string) => SessionStore,
  registry: UserRegistry,
  ctx: PluginContext,
): CommandDef {
  return {
    name: 'handoff',
    description: 'Transfer session ownership to another participant',
    usage: '@user',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const store = getSessionStore(args.sessionId)
      const session = await store.get()
      if (session?.type !== 'teamwork') return { type: 'error', message: 'Requires team mode.' }

      // Only the current owner can transfer ownership
      const source = (args.channelId === 'sse' || args.channelId === 'api') ? 'api' : args.channelId as IdentitySource
      const callerId = UR.buildIdentityId(source, args.userId)
      if (callerId !== session.owner) {
        return { type: 'error', message: 'Only the session owner can transfer ownership.' }
      }

      const mentions = extractMentions(args.raw)
      if (mentions.length === 0) return { type: 'error', message: 'Usage: /handoff @user' }

      const [newOwnerId] = await resolveMentions(mentions, registry)
      if (!newOwnerId) return { type: 'error', message: `User @${mentions[0]} not found.` }

      // New owner must be an active participant in this session
      const isParticipant = session.participants.some(p => p.identityId === newOwnerId)
      if (!isParticipant) {
        const user = await registry.getById(newOwnerId)
        return { type: 'error', message: `${user?.displayName ?? newOwnerId} is not a participant in this session.` }
      }

      await store.transferOwnership(newOwnerId)
      const user = await registry.getById(newOwnerId)
      const name = user?.displayName ?? newOwnerId

      await ctx.emitHook('handoff', { sessionId: args.sessionId, from: callerId, to: newOwnerId })

      return { type: 'text', text: `✅ Session ownership transferred to ${name}.` }
    },
  }
}
