import type { CommandDef } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { UserRegistry } from '../identity.js'

export function makeTeamCommand(
  getSessionStore: (sid: string) => SessionStore,
  registry: UserRegistry,
): CommandDef {
  return {
    name: 'team',
    description: 'List current participants and their presence status',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const session = await getSessionStore(args.sessionId).get()
      if (!session) return { type: 'text', text: 'No workspace session data yet.' }
      const lines = await Promise.all(session.participants.map(async p => {
        const user = await registry.getById(p.identityId)
        const name = user?.displayName ?? p.identityId
        const statusIcon = { active: '🟢', idle: '🟡', offline: '⚫' }[p.status]
        return `${statusIcon} ${name} (${p.role})`
      }))
      return { type: 'text', text: `**Team** [${session.type}]\n${lines.join('\n')}` }
    },
  }
}
