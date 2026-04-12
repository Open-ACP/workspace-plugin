import { describe, it, expect } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import { SessionStore } from '../session-store.js'
import { makeTeamworkCommand } from '../commands/teamwork.js'
import { makeWhoamiCommand } from '../commands/whoami.js'
import { makeTeamCommand } from '../commands/team.js'
import { makeAssignCommand } from '../commands/assign.js'
import { makePromoteCommand } from '../commands/promote.js'
import { createMockIdentityService } from './helpers.js'

function setup(sessionId = 'sess-1') {
  const ctx = createTestContext({
    pluginName: '@openacp/workspace-plugin',
    permissions: ['storage:read', 'storage:write', 'commands:register'],
  })
  const identity = createMockIdentityService()
  const getStore = (sid: string) => new SessionStore(ctx.storage.forSession(sid), sid)
  return { ctx, identity, getStore }
}

describe('/teamwork command', () => {
  it('activates teamwork mode', async () => {
    const { ctx, getStore, identity } = setup()
    identity.addUser({ userId: 'u_alice', displayName: 'Alice', role: 'member', identityId: 'telegram:123' })
    await getStore('sess-1').init('u_alice')
    const cmd = makeTeamworkCommand(getStore, ctx, identity)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    // Adaptive response — check fallback
    expect((result as any).fallback ?? (result as any).text).toContain('Team mode activated')
  })

  it('returns "already in team mode" when called twice', async () => {
    const { ctx, getStore, identity } = setup()
    identity.addUser({ userId: 'u_alice', displayName: 'Alice', role: 'member', identityId: 'telegram:123' })
    await getStore('sess-1').init('u_alice')
    await getStore('sess-1').activateTeamwork()
    const cmd = makeTeamworkCommand(getStore, ctx, identity)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect((result as any).text).toContain('Already in team mode')
  })

  it('returns error without active session', async () => {
    const { ctx, getStore, identity } = setup()
    const cmd = makeTeamworkCommand(getStore, ctx, identity)
    const result = await cmd.handler({ raw: '', sessionId: null, channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'error' })
  })

  it('initializes session when identity exists but no session record', async () => {
    const { ctx, getStore, identity } = setup()
    identity.addUser({ userId: 'u_alice', displayName: 'Alice', role: 'member', identityId: 'telegram:123' })
    const cmd = makeTeamworkCommand(getStore, ctx, identity)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect((result as any).fallback ?? (result as any).text).toContain('Team mode activated')
    const session = await getStore('sess-1').get()
    expect(session?.type).toBe('teamwork')
    expect(session?.owner).toBe('u_alice')
  })

  it('returns error when identity not found', async () => {
    const { ctx, getStore, identity } = setup()
    const cmd = makeTeamworkCommand(getStore, ctx, identity)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '999', reply: async () => {} })
    expect(result).toMatchObject({ type: 'error' })
    expect((result as any).message).toContain('Identity not found')
  })
})

describe('/whoami command', () => {
  it('updates username and display name', async () => {
    const { identity } = setup()
    identity.addUser({ userId: 'u_abc', displayName: 'Old Name', role: 'member', identityId: 'telegram:123' })
    const cmd = makeWhoamiCommand(identity)
    const result = await cmd.handler({ raw: '@lucas Lucas Nguyen', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect((result as any).text).toContain('@lucas')
    expect((result as any).text).toContain('Lucas Nguyen')
    const user = identity.users.get('u_abc')
    expect(user?.username).toBe('lucas')
    expect(user?.displayName).toBe('Lucas Nguyen')
  })

  it('returns error when no name given', async () => {
    const { identity } = setup()
    const cmd = makeWhoamiCommand(identity)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'error' })
  })

  it('returns error when identity not found', async () => {
    const { identity } = setup()
    const cmd = makeWhoamiCommand(identity)
    const result = await cmd.handler({ raw: '@lucas', sessionId: 'sess-1', channelId: 'telegram', userId: '999', reply: async () => {} })
    expect(result).toMatchObject({ type: 'error' })
    expect((result as any).message).toContain('Identity not found')
  })
})

describe('/team command', () => {
  it('lists participants with status', async () => {
    const { identity, getStore } = setup()
    identity.addUser({ userId: 'u_abc', displayName: 'Lucas', role: 'member', identityId: 'telegram:123' })
    await getStore('sess-1').init('u_abc')
    const cmd = makeTeamCommand(getStore, identity)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect((result as any).text).toContain('Lucas')
    expect((result as any).text).toContain('owner')
  })
})

describe('/assign command', () => {
  it('assigns task to a participant', async () => {
    const { ctx, getStore, identity } = setup()
    identity.addUser({ userId: 'u_alice', displayName: 'Alice', username: 'alice', role: 'member', identityId: 'telegram:123' })
    identity.addUser({ userId: 'u_bob', displayName: 'Bob', username: 'bob', role: 'member', identityId: 'telegram:456' })
    const store = getStore('sess-1')
    await store.init('u_alice')
    await store.activateTeamwork()
    await store.addParticipant('u_bob')
    const cmd = makeAssignCommand(getStore, identity, ctx)
    const result = await cmd.handler({ raw: '@bob Fix the bug', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'text' })
    expect((result as any).text).toContain('Bob')
    const session = await store.get()
    expect(session?.tasks).toHaveLength(1)
    expect(session?.tasks[0].assignee).toBe('u_bob')
  })

  it('rejects assignment to non-participant', async () => {
    const { ctx, getStore, identity } = setup()
    identity.addUser({ userId: 'u_alice', displayName: 'Alice', username: 'alice', role: 'member', identityId: 'telegram:123' })
    identity.addUser({ userId: 'u_stranger', displayName: 'Stranger', username: 'stranger', role: 'member', identityId: 'telegram:999' })
    const store = getStore('sess-1')
    await store.init('u_alice')
    await store.activateTeamwork()
    const cmd = makeAssignCommand(getStore, identity, ctx)
    const result = await cmd.handler({ raw: '@stranger Do something', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'error' })
    expect((result as any).message).toContain('not a participant')
  })

  it('requires teamwork mode', async () => {
    const { ctx, getStore, identity } = setup()
    await getStore('sess-1').init('u_alice')
    const cmd = makeAssignCommand(getStore, identity, ctx)
    const result = await cmd.handler({ raw: '@alice task', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'error' })
    expect((result as any).message).toContain('team mode')
  })
})

describe('/promote command', () => {
  it('transfers ownership to a participant', async () => {
    const { ctx, getStore, identity } = setup()
    identity.addUser({ userId: 'u_alice', displayName: 'Alice', username: 'alice', role: 'member', identityId: 'telegram:123' })
    identity.addUser({ userId: 'u_bob', displayName: 'Bob', username: 'bob', role: 'member', identityId: 'telegram:456' })
    const store = getStore('sess-1')
    await store.init('u_alice')
    await store.activateTeamwork()
    await store.addParticipant('u_bob')
    const cmd = makePromoteCommand(getStore, identity, ctx)
    const result = await cmd.handler({ raw: '@bob', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'text' })
    expect((result as any).text).toContain('Bob')
    const session = await store.get()
    expect(session?.owner).toBe('u_bob')
  })

  it('rejects promote by non-owner', async () => {
    const { ctx, getStore, identity } = setup()
    identity.addUser({ userId: 'u_alice', displayName: 'Alice', username: 'alice', role: 'member', identityId: 'telegram:123' })
    identity.addUser({ userId: 'u_bob', displayName: 'Bob', username: 'bob', role: 'member', identityId: 'telegram:456' })
    const store = getStore('sess-1')
    await store.init('u_alice')
    await store.activateTeamwork()
    await store.addParticipant('u_bob')
    const cmd = makePromoteCommand(getStore, identity, ctx)
    // Bob (456) tries to promote, but Alice is the owner
    const result = await cmd.handler({ raw: '@alice', sessionId: 'sess-1', channelId: 'telegram', userId: '456', reply: async () => {} })
    expect(result).toMatchObject({ type: 'error' })
    expect((result as any).message).toContain('owner')
  })

  it('rejects promote to non-participant', async () => {
    const { ctx, getStore, identity } = setup()
    identity.addUser({ userId: 'u_alice', displayName: 'Alice', username: 'alice', role: 'member', identityId: 'telegram:123' })
    identity.addUser({ userId: 'u_stranger', displayName: 'Stranger', username: 'stranger', role: 'member', identityId: 'telegram:999' })
    const store = getStore('sess-1')
    await store.init('u_alice')
    await store.activateTeamwork()
    const cmd = makePromoteCommand(getStore, identity, ctx)
    const result = await cmd.handler({ raw: '@stranger', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'error' })
    expect((result as any).message).toContain('not a participant')
  })
})
