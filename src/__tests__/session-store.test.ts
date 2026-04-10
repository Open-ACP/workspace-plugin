import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import { SessionStore } from '../session-store.js'

function makeStore(sessionId = 'sess-1') {
  const ctx = createTestContext({ pluginName: '@openacp/workspace-plugin', permissions: ['storage:read', 'storage:write'] })
  return new SessionStore(ctx.storage.forSession(sessionId), sessionId)
}

describe('SessionStore', () => {
  let store: SessionStore

  beforeEach(() => {
    store = makeStore()
  })

  it('initializes as solo session with owner', async () => {
    await store.init('telegram:123')
    const s = await store.get()
    expect(s?.type).toBe('solo')
    expect(s?.owner).toBe('telegram:123')
    expect(s?.participants[0]?.role).toBe('owner')
    expect(s?.systemPromptInjected).toBe(false)
  })

  it('init is idempotent — returns existing record', async () => {
    const first = await store.init('telegram:123')
    const second = await store.init('telegram:456')
    expect(second.owner).toBe('telegram:123')
  })

  it('activateTeamwork transitions to teamwork and resets systemPromptInjected', async () => {
    await store.init('telegram:123')
    await store.markSystemPromptInjected()
    await store.activateTeamwork()
    const s = await store.get()
    expect(s?.type).toBe('teamwork')
    expect(s?.systemPromptInjected).toBe(false)
  })

  it('activateTeamwork is idempotent on already-teamwork session', async () => {
    await store.init('telegram:123')
    await store.activateTeamwork()
    await store.activateTeamwork()
    const s = await store.get()
    expect(s?.type).toBe('teamwork')
  })

  it('addParticipant adds member if not already present', async () => {
    await store.init('telegram:123')
    const added = await store.addParticipant('telegram:456')
    expect(added).toBe(true)
    const s = await store.get()
    expect(s?.participants).toHaveLength(2)
    expect(s?.participants[1]?.identityId).toBe('telegram:456')
    expect(s?.participants[1]?.role).toBe('member')
  })

  it('addParticipant returns false for existing participant', async () => {
    await store.init('telegram:123')
    const added = await store.addParticipant('telegram:123')
    expect(added).toBe(false)
  })

  it('markSystemPromptInjected sets flag to true', async () => {
    await store.init('telegram:123')
    await store.activateTeamwork()
    await store.markSystemPromptInjected()
    const s = await store.get()
    expect(s?.systemPromptInjected).toBe(true)
  })

  it('addTask and completeTask', async () => {
    await store.init('telegram:123')
    const taskId = await store.addTask('Fix bug', 'telegram:456')
    let s = await store.get()
    expect(s?.tasks).toHaveLength(1)
    expect(s?.tasks[0]?.title).toBe('Fix bug')
    expect(s?.tasks[0]?.status).toBe('open')

    await store.completeTask(taskId)
    s = await store.get()
    expect(s?.tasks[0]?.status).toBe('done')
  })

  it('transferOwnership swaps roles', async () => {
    await store.init('telegram:123')
    await store.addParticipant('telegram:456')
    await store.transferOwnership('telegram:456')
    const s = await store.get()
    expect(s?.owner).toBe('telegram:456')
    const oldOwner = s?.participants.find(p => p.identityId === 'telegram:123')
    const newOwner = s?.participants.find(p => p.identityId === 'telegram:456')
    expect(oldOwner?.role).toBe('member')
    expect(newOwner?.role).toBe('owner')
  })

  it('updatePresence updates status and lastSeen', async () => {
    await store.init('telegram:123')
    await store.updatePresence('telegram:123', 'idle')
    const s = await store.get()
    expect(s?.participants[0]?.status).toBe('idle')
  })
})
