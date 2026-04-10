import type { CommandDef } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'

export function makeTeamworkCommand(getSessionStore: (sid: string) => SessionStore): CommandDef {
  return {
    name: 'teamwork',
    description: 'Activate team mode for this session (one-way, irreversible)',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const store = getSessionStore(args.sessionId)
      const session = await store.get()
      if (session?.type === 'teamwork') return { type: 'text', text: 'Already in team mode.' }
      await store.activateTeamwork()
      return { type: 'text', text: '✅ Team mode activated. The agent will now see who is speaking and can @mention participants.' }
    },
  }
}
