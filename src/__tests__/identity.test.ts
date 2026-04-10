import { describe, it, expect, beforeEach } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import { UserRegistry } from '../identity.js'

function makeStorage() {
  const ctx = createTestContext({ pluginName: '@openacp/workspace-plugin', permissions: ['storage:read', 'storage:write'] })
  return ctx.storage
}

describe('UserRegistry', () => {
  let registry: UserRegistry

  beforeEach(() => {
    registry = new UserRegistry(makeStorage())
  })

  it('creates and retrieves a user by identityId', async () => {
    await registry.upsert({ identityId: 'telegram:123', source: 'telegram' })
    const user = await registry.getById('telegram:123')
    expect(user?.identityId).toBe('telegram:123')
    expect(user?.source).toBe('telegram')
    expect(user?.registeredAt).toBeDefined()
  })

  it('resolves username to identityId', async () => {
    await registry.upsert({ identityId: 'api:abc', source: 'api', username: 'lucas' })
    const id = await registry.resolveUsername('lucas')
    expect(id).toBe('api:abc')
  })

  it('username index updates when username changes', async () => {
    await registry.upsert({ identityId: 'api:abc', source: 'api', username: 'old-name' })
    await registry.upsert({ identityId: 'api:abc', source: 'api', username: 'new-name' })
    expect(await registry.resolveUsername('new-name')).toBe('api:abc')
    expect(await registry.resolveUsername('old-name')).toBeUndefined()
  })

  it('buildIdentityId formats source:id correctly', () => {
    expect(UserRegistry.buildIdentityId('telegram', '123456')).toBe('telegram:123456')
    expect(UserRegistry.buildIdentityId('api', 'tok-abc')).toBe('api:tok-abc')
  })

  it('preserves registeredAt on update', async () => {
    await registry.upsert({ identityId: 'telegram:1', source: 'telegram' })
    const first = await registry.getById('telegram:1')
    await registry.upsert({ identityId: 'telegram:1', source: 'telegram', displayName: 'Updated' })
    const second = await registry.getById('telegram:1')
    expect(second?.registeredAt).toBe(first?.registeredAt)
    expect(second?.displayName).toBe('Updated')
  })

  it('links identities', async () => {
    await registry.upsert({ identityId: 'api:abc', source: 'api' })
    await registry.linkIdentities('api:abc', 'telegram:123')
    const user = await registry.getById('api:abc')
    expect(user?.linkedIdentities).toContain('telegram:123')
  })
})
