import { describe, it, expect } from 'vitest'
import { extractMentions, resolveMentions, extractMentionContext } from '../mentions.js'
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

describe('extractMentionContext', () => {
  it('returns context window around mention', () => {
    const text = 'We need @lucas to review PR #42 before merging into main'
    const result = extractMentionContext(text, 'lucas', 150)
    expect(result).toContain('@lucas')
    expect(result).toContain('review PR #42')
  })

  it('adds ellipsis when text is truncated at start', () => {
    const prefix = 'A'.repeat(200)
    const text = `${prefix} please ask @lucas to check`
    const result = extractMentionContext(text, 'lucas', 80)
    expect(result).toMatch(/^…/)
    expect(result).toContain('@lucas')
  })

  it('adds ellipsis when text is truncated at end', () => {
    const suffix = 'B'.repeat(200)
    const text = `Hey @lucas check this ${suffix}`
    const result = extractMentionContext(text, 'lucas', 80)
    expect(result).toMatch(/…$/)
    expect(result).toContain('@lucas')
  })

  it('collapses whitespace and newlines', () => {
    const text = 'line1\n\n  @lucas   check\n\nthis'
    const result = extractMentionContext(text, 'lucas', 150)
    expect(result).not.toContain('\n')
    expect(result).toMatch(/@lucas check/)
  })

  it('returns first maxLen chars if mention not found', () => {
    const text = 'A'.repeat(300)
    const result = extractMentionContext(text, 'nobody', 100)
    expect(result.length).toBeLessThanOrEqual(101)
    expect(result).toMatch(/…$/)
  })

  it('returns full text when shorter than maxLen', () => {
    const text = 'Hey @lucas check this'
    const result = extractMentionContext(text, 'lucas', 150)
    expect(result).toBe(text)
  })

  it('handles mention at very start of text', () => {
    const suffix = 'X'.repeat(200)
    const text = `@lucas please review ${suffix}`
    const result = extractMentionContext(text, 'lucas', 80)
    expect(result).toMatch(/^@lucas/)
    expect(result).toMatch(/…$/)
  })

  it('is case-insensitive when finding mention', () => {
    const text = 'Hey @Lucas please check this out'
    const result = extractMentionContext(text, 'lucas', 150)
    expect(result).toContain('@Lucas')
  })
})
