import type { CommandDef } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { UserRegistry } from '../identity.js'
import { extractMentions, resolveMentions } from '../mentions.js'

export function makeAssignCommand(
  getSessionStore: (sid: string) => SessionStore,
  registry: UserRegistry,
): CommandDef {
  return {
    name: 'assign',
    description: 'Assign a task to a participant',
    usage: '@user <task description>',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const session = await getSessionStore(args.sessionId).get()
      if (session?.type !== 'teamwork') return { type: 'error', message: 'Requires team mode. Run /teamwork first.' }
      const mentions = extractMentions(args.raw)
      if (mentions.length === 0) return { type: 'error', message: 'Usage: /assign @user <task description>' }
      const [assigneeId] = await resolveMentions(mentions, registry)
      if (!assigneeId) return { type: 'error', message: `User @${mentions[0]} not found. They need to send a message first.` }
      const title = args.raw.replace(/@[a-zA-Z0-9_.-]+/g, '').trim()
      if (!title) return { type: 'error', message: 'Please provide a task description.' }
      const taskId = await getSessionStore(args.sessionId).addTask(title, assigneeId)
      const user = await registry.getById(assigneeId)
      return { type: 'text', text: `✅ Task assigned to ${user?.displayName ?? assigneeId}: "${title}" (${taskId})` }
    },
  }
}
