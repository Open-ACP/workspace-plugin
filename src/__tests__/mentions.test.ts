import { describe, it, expect } from 'vitest'
import { extractMentions, resolveMentions } from '../mentions.js'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import { UserRegistry } from '../identity.js'

describe('extractMentions', () => {
  it('returns empty array when no mentions', () => {
    expect(extractMentions('hello world')).toEqual([])
  })
  it('extracts single mention', () => {
    expect(extractMentions('hey @lucas check this')).toEqual(['lucas'])
  })
  it('extracts multiple mentions', () => {
    expect(extractMentions('@minh and @lucas review this')).toEqual(['minh', 'lucas'])
  })
  it('handles mention at end of string', () => {
    expect(extractMentions('ping @lucas')).toEqual(['lucas'])
  })
  it('deduplicates repeated mentions', () => {
    expect(extractMentions('@lucas @lucas')).toEqual(['lucas'])
  })
  it('handles mention with dots and hyphens', () => {
    expect(extractMentions('cc @john.doe and @jane-smith')).toEqual(['john.doe', 'jane-smith'])
  })
})

describe('resolveMentions', () => {
  it('resolves usernames to identityIds via registry', async () => {
    const ctx = createTestContext({ pluginName: '@openacp/workspace-plugin', permissions: ['storage:read', 'storage:write'] })
    const registry = new UserRegistry(ctx.storage)
    await registry.upsert({ identityId: 'telegram:123', source: 'telegram', username: 'lucas' })
    const ids = await resolveMentions(['lucas', 'unknown'], registry)
    expect(ids).toEqual(['telegram:123'])
  })

  it('returns empty array when no usernames resolve', async () => {
    const ctx = createTestContext({ pluginName: '@openacp/workspace-plugin', permissions: ['storage:read', 'storage:write'] })
    const registry = new UserRegistry(ctx.storage)
    const ids = await resolveMentions(['nobody'], registry)
    expect(ids).toEqual([])
  })
})
