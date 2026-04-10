import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import { UserRegistry } from '../identity.js'
import { SessionStore } from '../session-store.js'
import { MessageStore } from '../message-store.js'
import { PresenceTracker } from '../presence.js'
import { TURN_META_SENDER_KEY, TURN_META_MENTIONS_KEY } from '../types.js'
import { registerMessageIncoming } from '../hooks/message-incoming.js'
import { registerAgentBeforePrompt } from '../hooks/agent-before-prompt.js'
import { registerAgentAfterTurn } from '../hooks/agent-after-turn.js'

function setup() {
  const ctx = createTestContext({
    pluginName: '@openacp/workspace-plugin',
    permissions: ['storage:read', 'storage:write', 'middleware:register', 'services:use'],
  })
  const registry = new UserRegistry(ctx.storage)
  const presence = new PresenceTracker()
  const getStore = (sid: string) => new SessionStore(ctx.storage.forSession(sid), sid)
  const getMsgStore = (sid: string) => new MessageStore(ctx.storage.forSession(sid))
  const isTeamwork = async (sid: string) => {
    const s = await getStore(sid).get()
    return s?.type === 'teamwork'
  }
  return { ctx, registry, presence, getStore, getMsgStore, isTeamwork }
}

describe('message:incoming hook', () => {
  it('registers middleware', () => {
    const { ctx, registry, presence } = setup()
    registerMessageIncoming(ctx, registry, presence)
    expect(ctx.registeredMiddleware.some(m => m.hook === 'message:incoming')).toBe(true)
  })

  it('handler attaches sender to meta', async () => {
    const { ctx, registry, presence } = setup()
    registerMessageIncoming(ctx, registry, presence)

    // Get the registered handler
    const mw = ctx.registeredMiddleware.find(m => m.hook === 'message:incoming')
    const handler = (mw?.opts as any).handler as Function

    const meta = { turnId: 't1' } as any
    const payload = { channelId: 'telegram', threadId: 'topic-1', userId: '123', text: 'hello', meta }
    const nextFn = async () => payload

    await handler(payload, nextFn)

    expect(meta[TURN_META_SENDER_KEY]).toBeDefined()
    expect(meta[TURN_META_SENDER_KEY].identityId).toBe('telegram:123')
  })
})

describe('agent:beforePrompt hook', () => {
  it('does not prefix text for solo sessions', async () => {
    const { ctx, registry, presence, getStore, getMsgStore } = setup()
    registerAgentBeforePrompt(ctx, registry, getStore, getMsgStore, presence)

    await registry.upsert({ identityId: 'telegram:123', source: 'telegram', displayName: 'Lucas' })
    await getStore('sess-1').init('telegram:123')

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:beforePrompt')
    const handler = (mw?.opts as any).handler as Function

    const meta = { turnId: 't1', [TURN_META_SENDER_KEY]: { identityId: 'telegram:123', displayName: 'Lucas' } }
    let resultPayload: any
    const payload = { sessionId: 'sess-1', text: 'hello', meta }
    await handler(payload, async () => { resultPayload = payload; return payload })

    // Solo session: text should NOT be prefixed
    expect(resultPayload.text).toBe('hello')
  })

  it('prefixes text with sender name for teamwork sessions', async () => {
    const { ctx, registry, presence, getStore, getMsgStore } = setup()
    registerAgentBeforePrompt(ctx, registry, getStore, getMsgStore, presence)

    await registry.upsert({ identityId: 'telegram:123', source: 'telegram', displayName: 'Lucas', username: 'lucas' })
    const store = getStore('sess-1')
    await store.init('telegram:123')
    await store.activateTeamwork()
    await store.markSystemPromptInjected()  // skip system prompt for this test

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:beforePrompt')
    const handler = (mw?.opts as any).handler as Function

    const meta = { turnId: 't1', [TURN_META_SENDER_KEY]: { identityId: 'telegram:123', displayName: 'Lucas', username: 'lucas' } }
    const payload = { sessionId: 'sess-1', text: 'hello', meta }
    await handler(payload, async () => payload)

    expect(payload.text).toContain('[Lucas (@lucas)]: hello')
  })

  it('injects system prompt on first teamwork turn', async () => {
    const { ctx, registry, presence, getStore, getMsgStore } = setup()
    registerAgentBeforePrompt(ctx, registry, getStore, getMsgStore, presence)

    await registry.upsert({ identityId: 'telegram:123', source: 'telegram', displayName: 'Lucas' })
    const store = getStore('sess-1')
    await store.init('telegram:123')
    await store.activateTeamwork()

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:beforePrompt')
    const handler = (mw?.opts as any).handler as Function

    const meta = { turnId: 't1', [TURN_META_SENDER_KEY]: { identityId: 'telegram:123', displayName: 'Lucas' } }
    const payload = { sessionId: 'sess-1', text: 'hello', meta }
    await handler(payload, async () => payload)

    expect(payload.text).toContain('[System: Team session.')
    // After injection, flag should be set
    const session = await store.get()
    expect(session?.systemPromptInjected).toBe(true)
  })

  it('persists message record', async () => {
    const { ctx, registry, presence, getStore, getMsgStore } = setup()
    registerAgentBeforePrompt(ctx, registry, getStore, getMsgStore, presence)

    await registry.upsert({ identityId: 'telegram:123', source: 'telegram' })
    await getStore('sess-1').init('telegram:123')

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:beforePrompt')
    const handler = (mw?.opts as any).handler as Function

    const meta = { turnId: 't1', [TURN_META_SENDER_KEY]: { identityId: 'telegram:123', displayName: '123' } }
    const payload = { sessionId: 'sess-1', text: 'hello', meta }
    await handler(payload, async () => payload)

    const msg = await getMsgStore('sess-1').getByTurnId('t1')
    expect(msg?.text).toBe('hello')
    expect(msg?.identityId).toBe('telegram:123')
  })
})

describe('agent:afterTurn hook', () => {
  it('sends mention notification for agent @mentions in teamwork sessions', async () => {
    const { ctx, registry, isTeamwork, getStore } = setup()
    registerAgentAfterTurn(ctx, registry, isTeamwork)

    await registry.upsert({ identityId: 'telegram:123', source: 'telegram', username: 'lucas' })
    const store = getStore('sess-1')
    await store.init('telegram:123')
    await store.activateTeamwork()

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:afterTurn')
    const handler = (mw?.opts as any).handler as Function

    const payload = { sessionId: 'sess-1', fullText: 'I need @lucas to review this', turnId: 't1' }
    await handler(payload, async () => payload)

    expect(ctx.sentMessages.length).toBe(1)
    expect(ctx.sentMessages[0].content).toMatchObject({ type: 'text' })
    expect((ctx.sentMessages[0].content as any).text).toContain('@lucas')
  })

  it('skips mention notification for solo sessions', async () => {
    const { ctx, registry, isTeamwork, getStore } = setup()
    registerAgentAfterTurn(ctx, registry, isTeamwork)

    await registry.upsert({ identityId: 'telegram:123', source: 'telegram', username: 'lucas' })
    await getStore('sess-1').init('telegram:123')
    // Note: NOT activating teamwork

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:afterTurn')
    const handler = (mw?.opts as any).handler as Function

    const payload = { sessionId: 'sess-1', fullText: '@lucas check this', turnId: 't1' }
    await handler(payload, async () => payload)

    expect(ctx.sentMessages.length).toBe(0)
  })
})
