import type { PluginContext } from '@openacp/plugin-sdk'
import type { UserRegistry } from '../identity.js'
import type { SessionStore } from '../session-store.js'
import type { MessageStore } from '../message-store.js'
import type { PresenceTracker } from '../presence.js'
import { TURN_META_SENDER_KEY, TURN_META_MENTIONS_KEY, type WorkspaceTurnSender } from '../types.js'

const TEAM_SYSTEM_PROMPT = (participants: string) =>
  `[System: Team session. ${participants}. Each message is prefixed with [Name]. ` +
  `You can @mention participants — they will be notified and can take action or make decisions.]`

export function registerAgentBeforePrompt(
  ctx: PluginContext,
  registry: UserRegistry,
  getSessionStore: (sessionId: string) => SessionStore,
  getMessageStore: (sessionId: string) => MessageStore,
  presence: PresenceTracker,
): void {
  ctx.registerMiddleware('agent:beforePrompt', {
    priority: 20,
    handler: async (payload, next) => {
      const { sessionId, meta } = payload as any
      const sender = meta?.[TURN_META_SENDER_KEY] as WorkspaceTurnSender | undefined
      const turnId: string = meta?.turnId ?? 'unknown'

      const store = getSessionStore(sessionId)
      let session = await store.get()

      // Initialize session record on first prompt if not yet done
      if (!session && sender) {
        session = await store.init(sender.identityId)
      }

      // Persist message record (for all sessions, not just teamwork)
      if (sender) {
        const msgStore = getMessageStore(sessionId)
        const mentionedIds = (meta?.[TURN_META_MENTIONS_KEY] as string[]) ?? []
        await msgStore.persist({
          turnId,
          identityId: sender.identityId,
          text: payload.text,
          mentions: mentionedIds,
          timestamp: new Date().toISOString(),
        })

        // Update presence
        presence.markActive(store, sessionId, sender.identityId)

        // Ensure sender is in participants list
        await store.addParticipant(sender.identityId)
      }

      // --- Teamwork-only behavior below ---
      session = await store.get()
      if (session?.type !== 'teamwork') return next()

      // Inject team system prompt on first turn after teamwork activation
      if (!session.systemPromptInjected && sender) {
        const participantNames = session.participants
          .map(p => `${p.identityId} (${p.role})`)
          .join(', ')
        ;(payload as any).text = `${TEAM_SYSTEM_PROMPT(participantNames)}\n\n${(payload as any).text}`
        await store.markSystemPromptInjected()
      }

      // Prefix sender name
      if (sender) {
        const name = sender.username
          ? `${sender.displayName} (@${sender.username})`
          : sender.displayName
        ;(payload as any).text = `[${name}]: ${(payload as any).text}`
      }

      // Notify in-thread for user @mentions
      const mentionedIds = (meta?.[TURN_META_MENTIONS_KEY] as string[]) ?? []
      for (const mentionedId of mentionedIds) {
        const mentionedUser = await registry.getById(mentionedId)
        await ctx.sendMessage(sessionId, {
          type: 'text' as const,
          text: `📢 ${sender?.displayName ?? 'Someone'} mentioned @${mentionedUser?.username ?? mentionedId} in this session.`,
        })
      }

      return next()
    },
  })
}
