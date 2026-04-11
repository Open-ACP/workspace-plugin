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

      ctx.log.info(`workspace: agent:beforePrompt — session=${sessionId} hasMeta=${!!meta} sender=${sender?.displayName ?? 'none'}`)

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
        const isNewParticipant = await store.addParticipant(sender.identityId)
        if (isNewParticipant && session?.type === 'teamwork') {
          await ctx.emitHook('userJoined', { sessionId, identityId: sender.identityId, role: 'member' })
        }
      }

      // --- Teamwork-only behavior below ---
      session = await store.get()
      ctx.log.info(`workspace: agent:beforePrompt — type=${session?.type} sysPromptInjected=${session?.systemPromptInjected}`)
      if (session?.type !== 'teamwork') return next()

      let userText: string = (payload as any).text

      // 1. Prefix sender name on the user's text
      if (sender) {
        const name = sender.username
          ? `${sender.displayName} (@${sender.username})`
          : sender.displayName
        userText = `[${name}]: ${userText}`
      }

      // 2. Inject team system prompt BEFORE the prefixed text (on first turn after activation).
      // Resolve display names from registry so the agent sees human names, not raw identityIds.
      // Also include the @username handle so the agent can form valid @mentions.
      if (!session.systemPromptInjected && sender) {
        const participantNames = (await Promise.all(
          session.participants.map(async p => {
            const user = await registry.getById(p.identityId)
            const name = user?.displayName ?? p.identityId
            const handle = user?.username ? ` (@${user.username})` : ''
            return `${name}${handle} [${p.role}]`
          })
        )).join(', ')
        userText = `${TEAM_SYSTEM_PROMPT(participantNames)}\n\n${userText}`
        await store.markSystemPromptInjected()
      }

      ;(payload as any).text = userText
      ctx.log.info(`workspace: agent:beforePrompt — text modified (len=${userText.length} sysPrompt=${userText.includes('[System:')} prefix=${userText.includes(']: ')})`)

      // 3. Notify in-thread for user @mentions and emit hook for SSE
      const mentionedIds = (meta?.[TURN_META_MENTIONS_KEY] as string[]) ?? []
      for (const mentionedId of mentionedIds) {
        const mentionedUser = await registry.getById(mentionedId)
        await ctx.sendMessage(sessionId, {
          type: 'text' as const,
          text: `📢 ${sender?.displayName ?? 'Someone'} mentioned @${mentionedUser?.username ?? mentionedId} in this session.`,
        })
        await ctx.emitHook('mention', {
          sessionId,
          turnId,
          mentionedBy: sender?.identityId ?? 'unknown',
          mentionedUser: mentionedId,
        })
      }

      return next()
    },
  })
}
