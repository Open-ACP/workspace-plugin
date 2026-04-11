import type { CommandDef, PluginContext } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { UserRegistry } from '../identity.js'
import { extractMentions, resolveMentions } from '../mentions.js'

export function makeAssignCommand(
  getSessionStore: (sid: string) => SessionStore,
  registry: UserRegistry,
  ctx: PluginContext,
): CommandDef {
  return {
    name: 'assign',
    description: 'Assign a task to a participant',
    usage: '@user <task description>',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const store = getSessionStore(args.sessionId)
      const session = await store.get()
      if (session?.type !== 'teamwork') return { type: 'error', message: 'Requires team mode. Run /teamwork first.' }

      const mentions = extractMentions(args.raw)
      if (mentions.length === 0) return { type: 'error', message: 'Usage: /assign @user <task description>' }

      const [assigneeId] = await resolveMentions(mentions, registry)
      if (!assigneeId) return { type: 'error', message: `User @${mentions[0]} not found. They need to send a message first.` }

      // Assignee must be a participant in this session
      const isParticipant = session.participants.some(p => p.identityId === assigneeId)
      if (!isParticipant) {
        const user = await registry.getById(assigneeId)
        return { type: 'error', message: `${user?.displayName ?? assigneeId} is not a participant in this session.` }
      }

      const title = args.raw.replace(/@[a-zA-Z0-9_.-]+/g, '').trim()
      if (!title) return { type: 'error', message: 'Please provide a task description.' }

      const taskId = await store.addTask(title, assigneeId)
      const user = await registry.getById(assigneeId)

      await ctx.emitHook('taskAssigned', { sessionId: args.sessionId, taskId, assignee: assigneeId, title })

      return { type: 'text', text: `✅ Task assigned to ${user?.displayName ?? assigneeId}: "${title}" (${taskId})` }
    },
  }
}
