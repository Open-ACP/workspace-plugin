import type { CommandDef } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { UserRegistry } from '../identity.js'
import { extractMentions, resolveMentions } from '../mentions.js'

export function makeHandoffCommand(
  getSessionStore: (sid: string) => SessionStore,
  registry: UserRegistry,
): CommandDef {
  return {
    name: 'handoff',
    description: 'Transfer session ownership to another participant',
    usage: '@user',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const session = await getSessionStore(args.sessionId).get()
      if (session?.type !== 'teamwork') return { type: 'error', message: 'Requires team mode.' }
      const mentions = extractMentions(args.raw)
      if (mentions.length === 0) return { type: 'error', message: 'Usage: /handoff @user' }
      const [newOwnerId] = await resolveMentions(mentions, registry)
      if (!newOwnerId) return { type: 'error', message: `User @${mentions[0]} not found.` }
      await getSessionStore(args.sessionId).transferOwnership(newOwnerId)
      const user = await registry.getById(newOwnerId)
      return { type: 'text', text: `✅ Session ownership transferred to ${user?.displayName ?? newOwnerId}.` }
    },
  }
}
