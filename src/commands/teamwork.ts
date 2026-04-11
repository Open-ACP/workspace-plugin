import type { CommandDef, PluginContext } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { UserRegistry } from '../identity.js'
import { UserRegistry as UR } from '../identity.js'
import type { IdentitySource } from '../types.js'

export function makeTeamworkCommand(
  getSessionStore: (sid: string) => SessionStore,
  ctx: PluginContext,
  registry: UserRegistry,
): CommandDef {
  return {
    name: 'teamwork',
    description: 'Activate team mode for this session (one-way, irreversible)',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const store = getSessionStore(args.sessionId)
      let session = await store.get()

      // Init session if first interaction is /teamwork (no message sent yet)
      if (!session) {
        const source = (args.channelId === 'sse' || args.channelId === 'api') ? 'api' : args.channelId as IdentitySource
        const identityId = UR.buildIdentityId(source, args.userId)
        await registry.upsert({ identityId, source })
        session = await store.init(identityId)
      }

      if (session.type === 'teamwork') return { type: 'text', text: 'Already in team mode.' }
      await store.activateTeamwork()
      await ctx.emitHook('teamworkActivated', { sessionId: args.sessionId })
      return { type: 'text', text: '✅ Team mode activated. The agent will now see who is speaking and can @mention participants.' }
    },
  }
}
