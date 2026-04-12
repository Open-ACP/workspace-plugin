import { describe, it, expect } from 'vitest'
import { extractMentions, resolveMentions } from '../mentions.js'
import { createMockIdentityService } from './helpers.js'

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
  it('resolves usernames to userIds via IdentityService', async () => {
    const identity = createMockIdentityService()
    identity.addUser({ userId: 'u_abc', displayName: 'Lucas', username: 'lucas', role: 'member', identityId: 'telegram:123' })
    const ids = await resolveMentions(['lucas', 'unknown'], identity)
    expect(ids).toEqual(['u_abc'])
  })

  it('returns empty array when no usernames resolve', async () => {
    const identity = createMockIdentityService()
    const ids = await resolveMentions(['nobody'], identity)
    expect(ids).toEqual([])
  })
})
