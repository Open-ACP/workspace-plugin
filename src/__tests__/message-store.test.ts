import { describe, it, expect } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import { MessageStore } from '../message-store.js'

function makeStore() {
  const ctx = createTestContext({ pluginName: '@openacp/workspace-plugin', permissions: ['storage:read', 'storage:write'] })
  return new MessageStore(ctx.storage.forSession('sess-1'))
}

describe('MessageStore', () => {
  it('persists and retrieves a message by turnId', async () => {
    const store = makeStore()
    await store.persist({ turnId: 't1', userId: 'u_abc', text: 'hello', mentions: [], timestamp: '2026-01-01T00:00:00Z' })
    const msg = await store.getByTurnId('t1')
    expect(msg?.text).toBe('hello')
    expect(msg?.userId).toBe('u_abc')
  })

  it('getHistory returns records sorted by timestamp', async () => {
    const store = makeStore()
    await store.persist({ turnId: 't2', userId: 'u_abc', text: 'second', mentions: [], timestamp: '2026-01-01T00:00:02Z' })
    await store.persist({ turnId: 't1', userId: 'u_abc', text: 'first', mentions: [], timestamp: '2026-01-01T00:00:01Z' })
    const history = await store.getHistory()
    expect(history.map(m => m.text)).toEqual(['first', 'second'])
  })

  it('getHistory returns empty array for empty store', async () => {
    const store = makeStore()
    const history = await store.getHistory()
    expect(history).toEqual([])
  })
})
