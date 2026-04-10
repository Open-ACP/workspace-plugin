import type { CommandDef } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { UserRegistry } from '../identity.js'

export function makeTasksCommand(
  getSessionStore: (sid: string) => SessionStore,
  registry: UserRegistry,
): CommandDef {
  return {
    name: 'tasks',
    description: 'List open tasks in this session',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const session = await getSessionStore(args.sessionId).get()
      const open = session?.tasks.filter(t => t.status === 'open') ?? []
      if (open.length === 0) return { type: 'text', text: 'No open tasks.' }
      const lines = await Promise.all(open.map(async t => {
        const assignee = t.assignee ? (await registry.getById(t.assignee))?.displayName ?? t.assignee : 'unassigned'
        return `• [${t.id}] ${t.title} → ${assignee}`
      }))
      return { type: 'text', text: `**Open tasks:**\n${lines.join('\n')}` }
    },
  }
}
