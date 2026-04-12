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
    await store.init('u_owner1')
    const s = await store.get()
    expect(s?.type).toBe('solo')
    expect(s?.owner).toBe('u_owner1')
    expect(s?.participants[0]?.role).toBe('owner')
    expect(s?.participants[0]?.userId).toBe('u_owner1')
    expect(s?.systemPromptInjected).toBe(false)
  })

  it('init is idempotent — returns existing record', async () => {
    const first = await store.init('u_owner1')
    const second = await store.init('u_owner2')
    expect(second.owner).toBe('u_owner1')
  })

  it('activateTeamwork transitions to teamwork and resets systemPromptInjected', async () => {
    await store.init('u_owner1')
    await store.markSystemPromptInjected()
    await store.activateTeamwork()
    const s = await store.get()
    expect(s?.type).toBe('teamwork')
    expect(s?.systemPromptInjected).toBe(false)
  })

  it('activateTeamwork is idempotent on already-teamwork session', async () => {
    await store.init('u_owner1')
    await store.activateTeamwork()
    await store.activateTeamwork()
    const s = await store.get()
    expect(s?.type).toBe('teamwork')
  })

  it('addParticipant adds member if not already present', async () => {
    await store.init('u_owner1')
    const added = await store.addParticipant('u_member1')
    expect(added).toBe(true)
    const s = await store.get()
    expect(s?.participants).toHaveLength(2)
    expect(s?.participants[1]?.userId).toBe('u_member1')
    expect(s?.participants[1]?.role).toBe('member')
  })

  it('addParticipant returns false for existing participant', async () => {
    await store.init('u_owner1')
    const added = await store.addParticipant('u_owner1')
    expect(added).toBe(false)
  })

  it('markSystemPromptInjected sets flag to true', async () => {
    await store.init('u_owner1')
    await store.activateTeamwork()
    await store.markSystemPromptInjected()
    const s = await store.get()
    expect(s?.systemPromptInjected).toBe(true)
  })

  it('addTask and completeTask', async () => {
    await store.init('u_owner1')
    const taskId = await store.addTask('Fix bug', 'u_member1')
    let s = await store.get()
    expect(s?.tasks).toHaveLength(1)
    expect(s?.tasks[0]?.title).toBe('Fix bug')
    expect(s?.tasks[0]?.status).toBe('open')

    await store.completeTask(taskId)
    s = await store.get()
    expect(s?.tasks[0]?.status).toBe('done')
  })

  it('transferOwnership swaps roles', async () => {
    await store.init('u_owner1')
    await store.addParticipant('u_member1')
    await store.transferOwnership('u_member1')
    const s = await store.get()
    expect(s?.owner).toBe('u_member1')
    const oldOwner = s?.participants.find(p => p.userId === 'u_owner1')
    const newOwner = s?.participants.find(p => p.userId === 'u_member1')
    expect(oldOwner?.role).toBe('member')
    expect(newOwner?.role).toBe('owner')
  })

  it('updatePresence updates status and lastSeen', async () => {
    await store.init('u_owner1')
    await store.updatePresence('u_owner1', 'idle')
    const s = await store.get()
    expect(s?.participants[0]?.status).toBe('idle')
  })
})
