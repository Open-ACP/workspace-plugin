import type { CommandDef, PluginContext } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'

export function makeTeamworkCommand(
  getSessionStore: (sid: string) => SessionStore,
  ctx: PluginContext,
): CommandDef {
  return {
    name: 'teamwork',
    description: 'Activate team mode for this session (one-way, irreversible)',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const store = getSessionStore(args.sessionId)
      const session = await store.get()
      if (!session) return { type: 'error', message: 'No session data yet. Send a message first.' }
      if (session.type === 'teamwork') return { type: 'text', text: 'Already in team mode.' }
      await store.activateTeamwork()
      await ctx.emitHook('teamworkActivated', { sessionId: args.sessionId })
      return { type: 'text', text: '✅ Team mode activated. The agent will now see who is speaking and can @mention participants.' }
    },
  }
}
