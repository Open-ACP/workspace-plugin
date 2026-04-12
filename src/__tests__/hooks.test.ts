import { describe, it, expect } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import { SessionStore } from '../session-store.js'
import { MessageStore } from '../message-store.js'
import { PresenceTracker } from '../presence.js'
import { TURN_META_MENTIONS_KEY } from '../types.js'
import { registerAgentBeforePrompt } from '../hooks/agent-before-prompt.js'
import { registerAgentAfterTurn } from '../hooks/agent-after-turn.js'
import { createMockIdentityService } from './helpers.js'

function setup() {
  const ctx = createTestContext({
    pluginName: '@openacp/workspace-plugin',
    permissions: ['storage:read', 'storage:write', 'middleware:register', 'services:use', 'kernel:access'],
  })
  const identity = createMockIdentityService()
  const presence = new PresenceTracker()
  const getStore = (sid: string) => new SessionStore(ctx.storage.forSession(sid), sid)
  const getMsgStore = (sid: string) => new MessageStore(ctx.storage.forSession(sid))
  const isTeamwork = async (sid: string) => {
    const s = await getStore(sid).get()
    return s?.type === 'teamwork'
  }
  return { ctx, identity, presence, getStore, getMsgStore, isTeamwork }
}

describe('agent:beforePrompt hook', () => {
  it('does not prefix text for solo sessions', async () => {
    const { ctx, identity, presence, getStore, getMsgStore } = setup()
    registerAgentBeforePrompt(ctx, identity, getStore, getMsgStore, presence)

    identity.addUser({ userId: 'u_abc', displayName: 'Lucas', role: 'member', identityId: 'telegram:123' })
    await getStore('sess-1').init('u_abc')

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:beforePrompt')
    const handler = (mw?.opts as any).handler as Function

    const meta = { turnId: 't1', identity: { userId: 'u_abc', identityId: 'telegram:123', displayName: 'Lucas', role: 'member' } }
    let resultPayload: any
    const payload = { sessionId: 'sess-1', text: 'hello', meta }
    await handler(payload, async () => { resultPayload = payload; return payload })

    expect(resultPayload.text).toBe('hello')
  })

  it('prefixes text with sender name for teamwork sessions', async () => {
    const { ctx, identity, presence, getStore, getMsgStore } = setup()
    registerAgentBeforePrompt(ctx, identity, getStore, getMsgStore, presence)

    identity.addUser({ userId: 'u_abc', displayName: 'Lucas', username: 'lucas', role: 'member', identityId: 'telegram:123' })
    const store = getStore('sess-1')
    await store.init('u_abc')
    await store.activateTeamwork()
    await store.markSystemPromptInjected()

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:beforePrompt')
    const handler = (mw?.opts as any).handler as Function

    const meta = { turnId: 't1', identity: { userId: 'u_abc', identityId: 'telegram:123', displayName: 'Lucas', username: 'lucas', role: 'member' } }
    const payload = { sessionId: 'sess-1', text: 'hello', meta }
    await handler(payload, async () => payload)

    expect(payload.text).toContain('[Lucas (@lucas)]: hello')
  })

  it('injects system prompt on first teamwork turn', async () => {
    const { ctx, identity, presence, getStore, getMsgStore } = setup()
    registerAgentBeforePrompt(ctx, identity, getStore, getMsgStore, presence)

    identity.addUser({ userId: 'u_abc', displayName: 'Lucas', username: 'lucas', role: 'member', identityId: 'telegram:123' })
    const store = getStore('sess-1')
    await store.init('u_abc')
    await store.activateTeamwork()

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:beforePrompt')
    const handler = (mw?.opts as any).handler as Function

    const meta = { turnId: 't1', identity: { userId: 'u_abc', identityId: 'telegram:123', displayName: 'Lucas', username: 'lucas', role: 'member' } }
    const payload = { sessionId: 'sess-1', text: 'hello', meta }
    await handler(payload, async () => payload)

    expect(payload.text).toContain('[System: Team session.')
    const systemIdx = payload.text.indexOf('[System:')
    const senderIdx = payload.text.indexOf('[Lucas (@lucas)]:')
    expect(systemIdx).toBeLessThan(senderIdx)
    const session = await store.get()
    expect(session?.systemPromptInjected).toBe(true)
  })

  it('persists message record', async () => {
    const { ctx, identity, presence, getStore, getMsgStore } = setup()
    registerAgentBeforePrompt(ctx, identity, getStore, getMsgStore, presence)

    identity.addUser({ userId: 'u_abc', displayName: 'Lucas', role: 'member', identityId: 'telegram:123' })
    await getStore('sess-1').init('u_abc')

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:beforePrompt')
    const handler = (mw?.opts as any).handler as Function

    const meta = { turnId: 't1', identity: { userId: 'u_abc', identityId: 'telegram:123', displayName: 'Lucas', role: 'member' } }
    const payload = { sessionId: 'sess-1', text: 'hello', meta }
    await handler(payload, async () => payload)

    const msg = await getMsgStore('sess-1').getByTurnId('t1')
    expect(msg?.text).toBe('hello')
    expect(msg?.userId).toBe('u_abc')
  })
})

describe('agent:afterTurn hook', () => {
  it('notifies for agent @mentions in teamwork sessions', async () => {
    const { ctx, identity, isTeamwork, getStore } = setup()
    registerAgentAfterTurn(ctx, identity, isTeamwork)

    identity.addUser({ userId: 'u_abc', displayName: 'Lucas', username: 'lucas', role: 'member', identityId: 'telegram:123' })
    const store = getStore('sess-1')
    await store.init('u_abc')
    await store.activateTeamwork()

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:afterTurn')
    const handler = (mw?.opts as any).handler as Function

    // Track notify calls via ctx.notify (cast as any for test)
    const notifyCalls: any[] = []
    ;(ctx as any).notify = (...args: any[]) => notifyCalls.push(args)

    const payload = { sessionId: 'sess-1', fullText: 'I need @lucas to review this', turnId: 't1' }
    await handler(payload, async () => payload)

    expect(notifyCalls.length).toBe(1)
    expect(notifyCalls[0][0]).toEqual({ userId: 'u_abc' })
    expect(notifyCalls[0][1].text).toContain('@lucas')
  })

  it('skips mention notification for solo sessions', async () => {
    const { ctx, identity, isTeamwork, getStore } = setup()
    registerAgentAfterTurn(ctx, identity, isTeamwork)

    identity.addUser({ userId: 'u_abc', displayName: 'Lucas', username: 'lucas', role: 'member', identityId: 'telegram:123' })
    await getStore('sess-1').init('u_abc')

    const mw = ctx.registeredMiddleware.find(m => m.hook === 'agent:afterTurn')
    const handler = (mw?.opts as any).handler as Function

    const notifyCalls: any[] = []
    ;(ctx as any).notify = (...args: any[]) => notifyCalls.push(args)

    const payload = { sessionId: 'sess-1', fullText: '@lucas check this', turnId: 't1' }
    await handler(payload, async () => payload)

    expect(notifyCalls.length).toBe(0)
  })
})
