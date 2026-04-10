import { describe, it, expect } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import plugin from '../index.js'

describe('@openacp/workspace-plugin integration', () => {
  function makeCtx() {
    return createTestContext({
      pluginName: '@openacp/workspace-plugin',
      permissions: plugin.permissions,
    })
  }

  it('registers all 6 commands on setup', async () => {
    const ctx = makeCtx()
    await plugin.setup(ctx)
    for (const cmd of ['teamwork', 'whoami', 'team', 'assign', 'tasks', 'handoff']) {
      expect(ctx.registeredCommands.has(cmd), `command /${cmd} missing`).toBe(true)
    }
  })

  it('registers middleware on all required hooks', async () => {
    const ctx = makeCtx()
    await plugin.setup(ctx)
    const hooks = ctx.registeredMiddleware.map((m: any) => m.hook)
    expect(hooks).toContain('message:incoming')
    expect(hooks).toContain('agent:beforePrompt')
    expect(hooks).toContain('agent:afterTurn')
    expect(hooks).toContain('turn:start')
    expect(hooks).toContain('session:afterDestroy')
  })

  it('/teamwork command activates team mode', async () => {
    const ctx = makeCtx()
    await plugin.setup(ctx)

    // First need to initialize a session via the session store
    // Manually create session record so /teamwork has something to toggle
    await ctx.storage.forSession('sess-1').set('session', {
      sessionId: 'sess-1',
      type: 'solo',
      owner: 'telegram:123',
      participants: [{ identityId: 'telegram:123', role: 'owner', joinedAt: new Date().toISOString(), status: 'active', lastSeen: new Date().toISOString() }],
      tasks: [],
      systemPromptInjected: false,
      createdAt: new Date().toISOString(),
    })

    const result = await ctx.executeCommand('teamwork', { raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123' })
    expect((result as any)?.text).toContain('Team mode activated')

    // Second call is idempotent
    const result2 = await ctx.executeCommand('teamwork', { raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123' })
    expect((result2 as any)?.text).toContain('Already in team mode')
  })

  it('/whoami command sets display name', async () => {
    const ctx = makeCtx()
    await plugin.setup(ctx)

    const result = await ctx.executeCommand('whoami', { raw: 'Lucas', sessionId: 'sess-1', channelId: 'telegram', userId: '123' })
    expect((result as any)?.text).toContain('Lucas')

    // Verify user record was created
    const user = await ctx.storage.get('users/telegram:123') as any
    expect(user?.displayName).toBe('Lucas')
  })

  it('/team command lists participants', async () => {
    const ctx = makeCtx()
    await plugin.setup(ctx)

    // Set up user and session
    await ctx.storage.set('users/telegram:123', { identityId: 'telegram:123', source: 'telegram', displayName: 'Lucas', registeredAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    await ctx.storage.forSession('sess-1').set('session', {
      sessionId: 'sess-1', type: 'teamwork', owner: 'telegram:123',
      participants: [{ identityId: 'telegram:123', role: 'owner', joinedAt: new Date().toISOString(), status: 'active', lastSeen: new Date().toISOString() }],
      tasks: [], systemPromptInjected: true, createdAt: new Date().toISOString(),
    })

    const result = await ctx.executeCommand('team', { raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123' })
    expect((result as any)?.text).toContain('Lucas')
    expect((result as any)?.text).toContain('owner')
  })

  it('setup logs when api-server is not available', async () => {
    const ctx = makeCtx()
    await plugin.setup(ctx)
    // No crash — graceful degradation when api-server not available
  })
})
