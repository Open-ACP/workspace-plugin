import { describe, it, expect } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import plugin from '../index.js'
import { createMockIdentityService } from './helpers.js'

describe('@openacp/workspace-plugin integration', () => {
  function makeCtx() {
    const identity = createMockIdentityService()
    const ctx = createTestContext({
      pluginName: '@openacp/workspace-plugin',
      permissions: plugin.permissions,
      services: { identity },
    })
    return { ctx, identity }
  }

  it('registers all 6 commands on setup', async () => {
    const { ctx } = makeCtx()
    await plugin.setup(ctx)
    for (const cmd of ['teamwork', 'whoami', 'team', 'assign', 'tasks', 'promote']) {
      expect(ctx.registeredCommands.has(cmd), `command /${cmd} missing`).toBe(true)
    }
  })

  it('registers middleware on required hooks (no message:incoming)', async () => {
    const { ctx } = makeCtx()
    await plugin.setup(ctx)
    const hooks = ctx.registeredMiddleware.map((m: any) => m.hook)
    // message:incoming is now handled by core identity plugin
    expect(hooks).not.toContain('message:incoming')
    expect(hooks).toContain('agent:beforePrompt')
    expect(hooks).toContain('agent:afterTurn')
    expect(hooks).toContain('turn:start')
    expect(hooks).toContain('session:afterDestroy')
  })

  it('/teamwork command activates team mode', async () => {
    const { ctx, identity } = makeCtx()
    await plugin.setup(ctx)

    identity.addUser({ userId: 'u_alice', displayName: 'Alice', role: 'member', identityId: 'telegram:123' })
    await ctx.storage.forSession('sess-1').set('session', {
      sessionId: 'sess-1',
      type: 'solo',
      owner: 'u_alice',
      participants: [{ userId: 'u_alice', role: 'owner', joinedAt: new Date().toISOString(), status: 'active', lastSeen: new Date().toISOString() }],
      tasks: [],
      systemPromptInjected: false,
      createdAt: new Date().toISOString(),
    })

    const result = await ctx.executeCommand('teamwork', { raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123' })
    const text = (result as any)?.fallback ?? (result as any)?.text
    expect(text).toContain('Team mode activated')

    // Second call is idempotent
    const result2 = await ctx.executeCommand('teamwork', { raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123' })
    expect((result2 as any)?.text).toContain('Already in team mode')
  })

  it('/whoami command updates profile via IdentityService', async () => {
    const { ctx, identity } = makeCtx()
    await plugin.setup(ctx)

    identity.addUser({ userId: 'u_abc', displayName: 'OldName', role: 'member', identityId: 'telegram:123' })
    const result = await ctx.executeCommand('whoami', { raw: '@lucas Lucas', sessionId: 'sess-1', channelId: 'telegram', userId: '123' })
    expect((result as any)?.text).toContain('@lucas')
    // Verify user was updated in identity service
    const user = identity.users.get('u_abc')
    expect(user?.username).toBe('lucas')
    expect(user?.displayName).toBe('Lucas')
  })

  it('/team command lists participants', async () => {
    const { ctx, identity } = makeCtx()
    await plugin.setup(ctx)

    identity.addUser({ userId: 'u_abc', displayName: 'Lucas', role: 'member', identityId: 'telegram:123' })
    await ctx.storage.forSession('sess-1').set('session', {
      sessionId: 'sess-1', type: 'teamwork', owner: 'u_abc',
      participants: [{ userId: 'u_abc', role: 'owner', joinedAt: new Date().toISOString(), status: 'active', lastSeen: new Date().toISOString() }],
      tasks: [], systemPromptInjected: true, createdAt: new Date().toISOString(),
    })

    const result = await ctx.executeCommand('team', { raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123' })
    expect((result as any)?.text).toContain('Lucas')
    expect((result as any)?.text).toContain('owner')
  })

  it('setup throws when identity service is not available', async () => {
    const ctx = createTestContext({
      pluginName: '@openacp/workspace-plugin',
      permissions: plugin.permissions,
      // No identity service provided
    })
    await expect(plugin.setup(ctx)).rejects.toThrow('identity')
  })
})
