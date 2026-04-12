import type { PluginContext } from '@openacp/plugin-sdk'
import type { IdentityService } from '../types.js'
import type { SessionStore } from '../session-store.js'
import type { MessageStore } from '../message-store.js'
import type { PresenceTracker } from '../presence.js'
import { TURN_META_MENTIONS_KEY, type IdentitySnapshot } from '../types.js'

const TEAM_SYSTEM_PROMPT = (participants: string) =>
  `[System: Team session. ${participants}. Each message is prefixed with [Name]. ` +
  `You can @mention participants — they will be notified and can take action or make decisions.]`

// EventBus is typed loosely in the plugin-sdk; narrow it here for safe emit calls.
type EventEmitter = { emit(event: string, data: unknown): void }

export function registerAgentBeforePrompt(
  ctx: PluginContext,
  identity: IdentityService,
  getSessionStore: (sessionId: string) => SessionStore,
  getMessageStore: (sessionId: string) => MessageStore,
  presence: PresenceTracker,
): void {
  const eventBus = ctx.eventBus as unknown as EventEmitter
  ctx.registerMiddleware('agent:beforePrompt', {
    priority: 20,
    handler: async (payload, next) => {
      const { sessionId, meta } = payload as any
      const sender = meta?.identity as IdentitySnapshot | undefined
      const turnId: string = meta?.turnId ?? 'unknown'

      ctx.log.info(`workspace: agent:beforePrompt — session=${sessionId} hasMeta=${!!meta} sender=${sender?.displayName ?? 'none'}`)

      const store = getSessionStore(sessionId)
      let session = await store.get()

      // Initialize session record on first prompt if not yet done
      if (!session && sender) {
        session = await store.init(sender.userId)
      }

      // Persist message record (for all sessions, not just teamwork)
      if (sender) {
        const msgStore = getMessageStore(sessionId)
        const mentionedIds = (meta?.[TURN_META_MENTIONS_KEY] as string[]) ?? []
        await msgStore.persist({
          turnId,
          userId: sender.userId,
          text: payload.text,
          mentions: mentionedIds,
          timestamp: new Date().toISOString(),
        })

        // Update presence
        presence.markActive(store, sessionId, sender.userId)

        // Ensure sender is in participants list
        const isNewParticipant = await store.addParticipant(sender.userId)
        if (isNewParticipant && session?.type === 'teamwork') {
          await ctx.emitHook('userJoined', { sessionId, userId: sender.userId, role: 'member' })
        }
      }

      // --- Teamwork-only behavior below ---
      session = await store.get()
      ctx.log.info(`workspace: agent:beforePrompt — type=${session?.type} sysPromptInjected=${session?.systemPromptInjected}`)
      if (session?.type !== 'teamwork') return next()

      // Require a username before participating in team sessions.
      if (!sender?.username) {
        const errorText = '⚠️ Team mode requires a username so others can @mention you.\n\nRun /whoami to set up your profile:\n/whoami @username [Display Name]\n\nExample: /whoami @alice Alice Nguyen'
        // Emit as agent events so SSE clients clear their streaming/thinking state.
        // text event shows the error; usage signals turn-end to the app.
        eventBus.emit('agent:event', { sessionId, event: { type: 'text', content: errorText } })
        eventBus.emit('agent:event', { sessionId, event: { type: 'usage' } })
        return null
      }

      let userText: string = (payload as any).text

      // 1. Prefix sender name on the user's text
      if (sender) {
        const name = sender.username
          ? `${sender.displayName} (@${sender.username})`
          : sender.displayName
        userText = `[${name}]: ${userText}`
      }

      // 2. Inject team system prompt on first turn after activation.
      if (!session.systemPromptInjected && sender) {
        const participantNames = (await Promise.all(
          session.participants.map(async p => {
            const user = await identity.getUser(p.userId)
            const name = user?.displayName ?? p.userId
            const handle = user?.username ? ` @${user.username}` : ''
            return `${name}${handle} (id:${p.userId}, ${p.role})`
          })
        )).join(', ')
        userText = `${TEAM_SYSTEM_PROMPT(participantNames)}\n\n${userText}`
        await store.markSystemPromptInjected()
      }

      ;(payload as any).text = userText
      ctx.log.info(`workspace: agent:beforePrompt — text modified (len=${userText.length} sysPrompt=${userText.includes('[System:')} prefix=${userText.includes(']: ')})`)

      // 3. Notify mentioned users via core notification service
      const mentionedIds = (meta?.[TURN_META_MENTIONS_KEY] as string[]) ?? []
      const notify = (ctx as any).notify?.bind(ctx) as ((t: any, m: any, o?: any) => void) | undefined
      for (const mentionedUserId of mentionedIds) {
        const mentionedUser = await identity.getUser(mentionedUserId)
        notify?.(
          { userId: mentionedUserId },
          { type: 'text', text: `${sender?.displayName ?? 'Someone'} mentioned @${mentionedUser?.username ?? mentionedUserId} in a session.` },
          { via: 'dm' },
        )
        await ctx.emitHook('mention', {
          sessionId,
          turnId,
          mentionedBy: sender?.userId ?? 'unknown',
          mentionedUser: mentionedUserId,
        })
      }

      return next()
    },
  })
}
