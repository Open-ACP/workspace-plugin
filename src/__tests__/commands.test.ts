import { describe, it, expect } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import { UserRegistry } from '../identity.js'
import { SessionStore } from '../session-store.js'
import { makeTeamworkCommand } from '../commands/teamwork.js'
import { makeWhoamiCommand } from '../commands/whoami.js'
import { makeTeamCommand } from '../commands/team.js'

function setup(sessionId = 'sess-1') {
  const ctx = createTestContext({
    pluginName: '@openacp/workspace-plugin',
    permissions: ['storage:read', 'storage:write', 'commands:register'],
  })
  const registry = new UserRegistry(ctx.storage)
  const getStore = (sid: string) => new SessionStore(ctx.storage.forSession(sid), sid)
  return { ctx, registry, getStore }
}

describe('/teamwork command', () => {
  it('activates teamwork mode', async () => {
    const { ctx, getStore, registry } = setup()
    await getStore('sess-1').init('telegram:123')
    const cmd = makeTeamworkCommand(getStore, ctx, registry)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'text' })
    expect((result as any).text).toContain('Team mode activated')
  })

  it('returns "already in team mode" when called twice', async () => {
    const { ctx, getStore, registry } = setup()
    await getStore('sess-1').init('telegram:123')
    await getStore('sess-1').activateTeamwork()
    const cmd = makeTeamworkCommand(getStore, ctx, registry)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect((result as any).text).toContain('Already in team mode')
  })

  it('returns error without active session', async () => {
    const { ctx, getStore, registry } = setup()
    const cmd = makeTeamworkCommand(getStore, ctx, registry)
    const result = await cmd.handler({ raw: '', sessionId: null, channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'error' })
  })

  it('initializes session and activates teamwork when no session exists', async () => {
    const { ctx, getStore, registry } = setup()
    const cmd = makeTeamworkCommand(getStore, ctx, registry)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'text' })
    expect((result as any).text).toContain('Team mode activated')
    // Session should be initialized as teamwork
    const session = await getStore('sess-1').get()
    expect(session?.type).toBe('teamwork')
    expect(session?.owner).toBe('telegram:123')
  })
})

describe('/whoami command', () => {
  it('sets display name', async () => {
    const { registry } = setup()
    const cmd = makeWhoamiCommand(registry)
    await cmd.handler({ raw: 'Lucas Nguyen', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    const user = await registry.getById('telegram:123')
    expect(user?.displayName).toBe('Lucas Nguyen')
  })

  it('returns error when no name given', async () => {
    const { registry } = setup()
    const cmd = makeWhoamiCommand(registry)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'error' })
  })
})

describe('/team command', () => {
  it('lists participants with status', async () => {
    const { registry, getStore } = setup()
    await registry.upsert({ identityId: 'telegram:123', source: 'telegram', displayName: 'Lucas' })
    await getStore('sess-1').init('telegram:123')
    const cmd = makeTeamCommand(getStore, registry)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect((result as any).text).toContain('Lucas')
    expect((result as any).text).toContain('owner')
  })
})
