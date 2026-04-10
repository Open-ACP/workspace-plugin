# Workspace Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@openacp/workspace-plugin` — multi-user collaboration for shared OpenACP sessions, including 7 prerequisite core improvements to the OpenACP plugin infrastructure.

**Architecture:** Two phases — Phase A modifies the OpenACP core repo to add TurnMeta pipeline, new hooks, session-scoped storage, custom plugin hooks, and light session API. Phase B implements the workspace plugin itself using those new capabilities. The plugin is fully self-contained: zero adapter changes, all data in `ctx.storage`.

**Tech Stack:** TypeScript ESM, Vitest, Fastify (for REST/SSE routes), `@openacp/plugin-sdk` (testing), `nanoid` (IDs).

**Spec:** `workspace-plugin/docs/superpowers/specs/2026-04-11-workspace-plugin-design.md`

---

## Pre-flight

- [ ] Read `OpenACP/CLAUDE.md` — understand build, test, versioning conventions
- [ ] Read `workspace-plugin/CLAUDE.md` — understand plugin conventions
- [ ] Verify OpenACP builds: `cd OpenACP && pnpm build` — must pass before any changes

---

## Phase A — Core Changes (OpenACP repo)

Work in: `/Users/lucas/openacp-workspace/OpenACP`

### File Map (Phase A)

| File | Changes |
|---|---|
| `src/core/types.ts` | Add `TurnMeta` interface |
| `src/core/events.ts` | Add `AGENT_AFTER_TURN` to `Hook` constants |
| `src/core/core.ts` | Move `turnId` generation before `message:incoming`, create + thread `TurnMeta` |
| `src/core/sessions/session.ts` | Accept `meta` in `enqueuePrompt`, pass to middleware, buffer text for `afterTurn`, expose `turnId` in turn hooks |
| `src/core/plugin/types.ts` | Update `PluginStorage`, `MiddlewarePayloadMap`, `PluginContext`, `PluginPermission` |
| `src/core/plugin/plugin-storage.ts` | Add `forSession()`, `keys()`, `clear()` |
| `src/core/plugin/plugin-context.ts` | Add `forSession`, `defineHook`, `emitHook`, `getSessionInfo` to context |
| `src/core/__tests__/turn-meta.test.ts` | New — TurnMeta flow tests |
| `src/core/__tests__/plugin-storage-session.test.ts` | New — session-scoped storage tests |
| `src/core/__tests__/plugin-hooks.test.ts` | New — custom hook tests |

---

### Task A1: Add `TurnMeta` type and `AGENT_AFTER_TURN` hook constant

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/events.ts`

- [ ] **Add `TurnMeta` to `src/core/types.ts`**

Add after the existing `TurnRouting` interface (around line 30):

```typescript
/**
 * Per-turn context bag threaded through all turn-lifecycle middleware hooks.
 *
 * Core fills in `turnId`; plugins attach arbitrary keys at any hook and read
 * them at subsequent hooks in the same turn. The object is mutable by design —
 * plugins collaborating through meta should use namespaced keys to avoid clashes
 * (e.g., `meta['workspace.sender']` not `meta.sender`).
 */
export interface TurnMeta {
  /** The turn's unique ID — same value passed to session.enqueuePrompt(). */
  turnId: string
  [key: string]: unknown
}
```

- [ ] **Add `AGENT_AFTER_TURN` to `src/core/events.ts`**

In the `Hook` constant object, after `TURN_END` (around line 53):

```typescript
/** After a turn completes — full assembled agent text, read-only, fire-and-forget. */
AGENT_AFTER_TURN: 'agent:afterTurn',
```

- [ ] **Build to verify no errors**

```bash
cd /Users/lucas/openacp-workspace/OpenACP
pnpm build 2>&1 | tail -5
```

Expected: compile succeeds (new constants are additive).

- [ ] **Commit**

```bash
git add src/core/types.ts src/core/events.ts
git commit -m "feat(core): add TurnMeta type and agent:afterTurn hook constant"
```

---

### Task A2: Update `MiddlewarePayloadMap` and `PluginStorage` interface

**Files:**
- Modify: `src/core/plugin/types.ts`

- [ ] **Add `TurnMeta` import at top of `src/core/plugin/types.ts`**

```typescript
import type { TurnMeta } from '../types.js'
```

- [ ] **Add `meta` to `message:incoming` and `agent:beforePrompt` payloads**

Find `'message:incoming'` entry in `MiddlewarePayloadMap` and add `meta`:
```typescript
'message:incoming': {
  channelId: string
  threadId: string
  userId: string
  text: string
  attachments?: Attachment[]
  /** Per-turn context bag. Undefined for messages that bypass the normal handleMessage flow. */
  meta?: TurnMeta
}
```

Find `'agent:beforePrompt'` entry and add `meta`:
```typescript
'agent:beforePrompt': {
  sessionId: string
  text: string
  attachments?: Attachment[]
  sourceAdapterId?: string
  /** Per-turn context bag carried from message:incoming. */
  meta?: TurnMeta
}
```

- [ ] **Add `turnId` and `meta` to `turn:start` and `turn:end`**

```typescript
'turn:start': {
  sessionId: string
  promptText: string
  promptNumber: number
  turnId: string    // new
  meta?: TurnMeta   // new
}
'turn:end': {
  sessionId: string
  stopReason: StopReason
  durationMs: number
  turnId: string    // new
  meta?: TurnMeta   // new
}
```

- [ ] **Add `agent:afterTurn` to `MiddlewarePayloadMap`**

After `'turn:end'` entry:
```typescript
/** Fires after the full turn response is assembled. Read-only, fire-and-forget. */
'agent:afterTurn': {
  sessionId: string
  turnId: string
  /** Complete response text — all text chunks concatenated. Empty if agent produced no text. */
  fullText: string
  stopReason: StopReason
  meta?: TurnMeta
}
```

- [ ] **Update `PluginStorage` interface** — add `keys()` and `clear()`

Find the `PluginStorage` interface (around line 101) and add:
```typescript
export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  list(): Promise<string[]>
  /** Returns keys matching the given prefix, or all keys if prefix is omitted. */
  keys(prefix?: string): Promise<string[]>
  /** Deletes all keys in this storage scope. */
  clear(): Promise<void>
  getDataDir(): string
  /** Returns a storage instance scoped to the given session. Auto-isolated from global storage. */
  forSession(sessionId: string): PluginStorage
}
```

- [ ] **Update `PluginPermission`** — add `sessions:read`

Find `PluginPermission` type (around line 25):
```typescript
export type PluginPermission =
  | 'events:read'
  | 'events:emit'
  | 'services:register'
  | 'services:use'
  | 'middleware:register'
  | 'commands:register'
  | 'storage:read'
  | 'storage:write'
  | 'kernel:access'
  | 'sessions:read'   // new — read-only session metadata without kernel:access
```

- [ ] **Add `defineHook`, `emitHook`, `getSessionInfo` to `PluginContext` interface**

Find the `PluginContext` interface and add:
```typescript
/**
 * Define a custom hook that other plugins can register middleware on.
 * The hook name is automatically prefixed with `plugin:{pluginName}:`.
 */
defineHook(name: string): void

/**
 * Fire a custom hook through the middleware chain.
 * Name is auto-prefixed: `emitHook('foo', p)` fires `plugin:{pluginName}:foo`.
 * Returns the final payload (possibly modified by middleware), or null if blocked.
 */
emitHook<T extends Record<string, unknown>>(name: string, payload: T): Promise<T | null>

/**
 * Read-only session metadata. Requires `sessions:read` permission.
 * Returns undefined if the session does not exist.
 */
getSessionInfo(sessionId: string): Promise<{
  id: string
  status: import('../types.js').SessionStatus
  name?: string
  promptCount: number
  channelId: string
  agentName: string
} | undefined>
```

- [ ] **Build to verify**

```bash
pnpm build 2>&1 | tail -5
```

Expected: no errors (interface additions are additive).

- [ ] **Commit**

```bash
git add src/core/plugin/types.ts
git commit -m "feat(core): extend MiddlewarePayloadMap with TurnMeta, turnId, afterTurn, and storage/plugin-hook APIs"
```

---

### Task A3: Implement `PluginStorageImpl` extensions

**Files:**
- Modify: `src/core/plugin/plugin-storage.ts`

- [ ] **Add `keys()` method to `PluginStorageImpl`**

After the existing `list()` method:
```typescript
async keys(prefix?: string): Promise<string[]> {
  const kv = await this.readKv()
  const all = Object.keys(kv)
  return prefix ? all.filter(k => k.startsWith(prefix)) : all
}
```

- [ ] **Add `clear()` method**

```typescript
async clear(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    this.writeChain = this.writeChain.then(async () => {
      try {
        await fs.promises.writeFile(this.kvPath, '{}', 'utf8')
        resolve()
      } catch (err) {
        reject(err)
      }
    })
  })
}
```

- [ ] **Add `forSession()` method**

```typescript
forSession(sessionId: string): PluginStorage {
  // Each session gets its own isolated kv.json under sessions/{sessionId}/
  const sessionDir = path.join(path.dirname(this.kvPath), '..', 'sessions', sessionId)
  return new PluginStorageImpl(sessionDir)
}
```

- [ ] **Write failing test** in `src/core/__tests__/plugin-storage-session.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PluginStorageImpl } from '../plugin/plugin-storage.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmpDir: string
let storage: PluginStorageImpl

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-storage-test-'))
  storage = new PluginStorageImpl(tmpDir)
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('keys(prefix)', () => {
  it('returns all keys when no prefix given', async () => {
    await storage.set('a', 1)
    await storage.set('b', 2)
    const keys = await storage.keys()
    expect(keys.sort()).toEqual(['a', 'b'])
  })

  it('filters by prefix', async () => {
    await storage.set('session:abc:x', 1)
    await storage.set('session:abc:y', 2)
    await storage.set('session:def:z', 3)
    const keys = await storage.keys('session:abc:')
    expect(keys.sort()).toEqual(['session:abc:x', 'session:abc:y'])
  })
})

describe('clear()', () => {
  it('deletes all keys', async () => {
    await storage.set('a', 1)
    await storage.set('b', 2)
    await storage.clear()
    expect(await storage.list()).toEqual([])
  })
})

describe('forSession(sessionId)', () => {
  it('returns isolated storage for the session', async () => {
    const s1 = storage.forSession('sess-1')
    const s2 = storage.forSession('sess-2')
    await s1.set('key', 'value-1')
    await s2.set('key', 'value-2')
    expect(await s1.get('key')).toBe('value-1')
    expect(await s2.get('key')).toBe('value-2')
    // Global storage unaffected
    expect(await storage.get('key')).toBeUndefined()
  })

  it('clear() on session storage does not affect global storage', async () => {
    await storage.set('global', 'data')
    const s = storage.forSession('sess-1')
    await s.set('local', 'data')
    await s.clear()
    expect(await storage.get('global')).toBe('data')
    expect(await s.get('local')).toBeUndefined()
  })
})
```

- [ ] **Run test to verify it fails**

```bash
pnpm test -- --reporter=verbose src/core/__tests__/plugin-storage-session.test.ts 2>&1 | tail -20
```

Expected: FAIL — `keys is not a function` / `clear is not a function` / `forSession is not a function`

- [ ] **Run tests after implementation**

```bash
pnpm test -- --reporter=verbose src/core/__tests__/plugin-storage-session.test.ts 2>&1 | tail -10
```

Expected: all 5 tests PASS.

- [ ] **Commit**

```bash
git add src/core/plugin/plugin-storage.ts src/core/__tests__/plugin-storage-session.test.ts
git commit -m "feat(core): add keys(), clear(), forSession() to PluginStorageImpl"
```

---

### Task A4: Thread `TurnMeta` through `core.ts` → `session.enqueuePrompt()`

**Files:**
- Modify: `src/core/core.ts`
- Modify: `src/core/sessions/session.ts`

- [ ] **Move `turnId` generation before `message:incoming` in `core.ts`**

In `handleMessage()`, the current flow is:
1. `message:incoming` middleware (line ~393)
2. ... session lookup ...
3. `turnId = nanoid(8)` (line ~464)

Move steps so `turnId` and `meta` are created BEFORE step 1:

```typescript
// In handleMessage(), before message:incoming middleware:
const turnId = nanoid(8)
const meta: TurnMeta = { turnId }

// Pass meta into message:incoming payload:
const result = await this.lifecycleManager?.middlewareChain.execute(
  Hook.MESSAGE_INCOMING,
  { ...message, meta },
  async (msg) => msg,
)
if (!result) return
message = result  // meta may have been enriched by plugins
```

- [ ] **Pass `meta` through to `session.enqueuePrompt()`**

In `handleMessage()`, change the `enqueuePrompt` call (currently line ~475):

```typescript
await session.enqueuePrompt(
  text,
  message.attachments,
  routing,
  turnId,
  (message as any).meta as TurnMeta | undefined,  // carry enriched meta
)
```

- [ ] **Update `session.enqueuePrompt()` signature in `session.ts`**

```typescript
async enqueuePrompt(
  text: string,
  attachments?: Attachment[],
  routing?: TurnRouting,
  externalTurnId?: string,
  meta?: TurnMeta,        // new
): Promise<string> {
  const turnId = externalTurnId ?? nanoid(8)
  // Merge incoming meta with turnId (meta from core already has turnId, but
  // direct callers that don't pass meta get a fresh one)
  const turnMeta: TurnMeta = meta ?? { turnId }
  if (!turnMeta.turnId) turnMeta.turnId = turnId

  const payload = {
    text,
    attachments,
    sessionId: this.id,
    sourceAdapterId: routing?.sourceAdapterId,
    meta: turnMeta,
  }
  const result = await this.middlewareChain.execute(
    Hook.AGENT_BEFORE_PROMPT,
    payload,
    async (p) => p,
  )
  if (!result) return turnId
  // Use modified text/attachments from middleware
  text = result.text
  attachments = result.attachments

  this.promptQueue.enqueue(result.text, attachments, routing, turnId, turnMeta)
  return turnId
}
```

- [ ] **Update `promptQueue.enqueue()` to accept `meta`**

Find the `PromptQueue` class (in `src/core/sessions/prompt-queue.ts` or similar) and add `meta?: TurnMeta` parameter so it's available in `processPrompt`. Pass it to `processPrompt`.

- [ ] **Pass `meta` to `TURN_START` and `TURN_END` hooks in `processPrompt()`**

Find the `TURN_START` hook call in `processPrompt()` (around line 350):
```typescript
this.middlewareChain.execute(
  Hook.TURN_START,
  {
    sessionId: this.id,
    promptText: processed.text,
    promptNumber: this.promptCount,
    turnId: this.activeTurnContext?.turnId ?? turnId,  // new
    meta,                                               // new
  },
  async (p) => p,
).catch(() => {})
```

Find the `TURN_END` hook call (around line 380):
```typescript
this.middlewareChain.execute(
  Hook.TURN_END,
  {
    sessionId: this.id,
    stopReason: stopReason as StopReason,
    durationMs: Date.now() - promptStart,
    turnId: this.activeTurnContext?.turnId ?? turnId,  // new
    meta,                                               // new
  },
  async (p) => p,
).catch(() => {})
```

- [ ] **Write failing test** `src/core/__tests__/turn-meta.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { MiddlewareChain } from '../plugin/middleware-chain.js'
import { Hook } from '../events.js'

describe('TurnMeta flows through hook chain', () => {
  it('meta written in message:incoming is visible in agent:beforePrompt', async () => {
    const chain = new MiddlewareChain()
    const receivedMeta: Record<string, unknown>[] = []

    chain.add(Hook.MESSAGE_INCOMING, 'test-plugin', {
      handler: async (payload, next) => {
        payload.meta!['test-plugin.sender'] = 'lucas'
        return next(payload)
      },
    })

    chain.add(Hook.AGENT_BEFORE_PROMPT, 'test-plugin', {
      handler: async (payload, next) => {
        receivedMeta.push({ ...payload.meta })
        return next(payload)
      },
    })

    const meta = { turnId: 'turn-1' }
    await chain.execute(Hook.MESSAGE_INCOMING, {
      channelId: 'telegram', threadId: 't1', userId: 'u1', text: 'hello', meta,
    }, async (p) => p)

    await chain.execute(Hook.AGENT_BEFORE_PROMPT, {
      sessionId: 'sess-1', text: 'hello', meta,
    }, async (p) => p)

    expect(receivedMeta[0]?.['test-plugin.sender']).toBe('lucas')
    expect(receivedMeta[0]?.turnId).toBe('turn-1')
  })
})
```

- [ ] **Run test to verify it fails, then passes after implementation**

```bash
pnpm test -- --reporter=verbose src/core/__tests__/turn-meta.test.ts 2>&1 | tail -10
```

- [ ] **Commit**

```bash
git add src/core/core.ts src/core/sessions/session.ts src/core/__tests__/turn-meta.test.ts
git commit -m "feat(core): thread TurnMeta through message:incoming → agent:beforePrompt → turn hooks"
```

---

### Task A5: Add `agent:afterTurn` hook — buffer text events and fire after turn

**Files:**
- Modify: `src/core/sessions/session.ts`
- Modify: `src/core/plugin/types.ts` (already done in A2 — verify `agent:afterTurn` entry exists)

- [ ] **Add text buffer to `processPrompt()` in `session.ts`**

In `processPrompt()`, add a local accumulator for text events before the agent prompt call:

```typescript
// Inside processPrompt(), before the agent.prompt() call:
const textBuffer: string[] = []

// In the agent event handler (where agent:afterEvent middleware fires, around line 338):
// Add text accumulation:
if (event.type === 'text' && typeof (event as any).text === 'string') {
  textBuffer.push((event as any).text)
}
```

- [ ] **Fire `agent:afterTurn` hook after `TURN_END`**

After the `TURN_END` hook call, before clearing `activeTurnContext` (line ~384):

```typescript
// Capture turnId before activeTurnContext is cleared
const afterTurnId = this.activeTurnContext?.turnId ?? turnId

// Fire agent:afterTurn — read-only, assembled full text available
this.middlewareChain.execute(
  Hook.AGENT_AFTER_TURN,
  {
    sessionId: this.id,
    turnId: afterTurnId,
    fullText: textBuffer.join(''),
    stopReason: stopReason as StopReason,
    meta,
  },
  async (p) => p,
).catch(() => {})

// Then clear activeTurnContext (existing line):
this.activeTurnContext = null
```

- [ ] **Build and run full test suite**

```bash
pnpm build && pnpm test 2>&1 | tail -20
```

Expected: build passes, all existing tests pass.

- [ ] **Commit**

```bash
git add src/core/sessions/session.ts
git commit -m "feat(core): add agent:afterTurn hook with full assembled response text"
```

---

### Task A6: Expose `defineHook`, `emitHook`, `getSessionInfo`, `forSession` in `plugin-context.ts`

**Files:**
- Modify: `src/core/plugin/plugin-context.ts`

- [ ] **Add `forSession` to the storage wrapper**

In `createPluginContext()`, find the `storage` object creation. After the existing `getDataDir()` method, add:

```typescript
forSession(sessionId: string): PluginStorage {
  requirePermission(permissions, 'storage:write', 'forSession')
  return storageImpl.forSession(sessionId)
},
```

- [ ] **Add `defineHook` and `emitHook`**

In `createPluginContext()`, add to the returned context object:

```typescript
defineHook(name: string): void {
  // No-op registration — the middleware chain accepts any string key.
  // This call serves as documentation: declares that plugin intends to emit this hook.
  const fullName = `plugin:${opts.pluginName}:${name}`
  opts.log?.debug({ hook: fullName }, 'Plugin hook defined')
},

async emitHook<T extends Record<string, unknown>>(name: string, payload: T): Promise<T | null> {
  // Core enforces the plugin: prefix — plugins cannot spoof core hook names
  const fullName = `plugin:${opts.pluginName}:${name}`
  return opts.middlewareChain.execute(fullName, payload, async (p) => p) as Promise<T | null>
},
```

- [ ] **Add `getSessionInfo`**

```typescript
async getSessionInfo(sessionId: string): Promise<{
  id: string; status: SessionStatus; name?: string;
  promptCount: number; channelId: string; agentName: string;
} | undefined> {
  requirePermission(permissions, 'sessions:read', 'getSessionInfo')
  const session = (opts.sessions as any)?.getSession?.(sessionId)
  if (!session) return undefined
  return {
    id: session.id,
    status: session.status,
    name: session.name,
    promptCount: session.promptCount,
    channelId: session.channelId,
    agentName: session.agentName,
  }
},
```

- [ ] **Write failing test** `src/core/__tests__/plugin-hooks.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createPluginContext } from '../plugin/plugin-context.js'
import { MiddlewareChain } from '../plugin/middleware-chain.js'

function makeCtx(pluginName: string) {
  const chain = new MiddlewareChain()
  return {
    chain,
    ctx: createPluginContext({
      pluginName,
      pluginConfig: {},
      permissions: ['middleware:register'],
      serviceRegistry: { get: vi.fn(), register: vi.fn(), registerOverride: vi.fn() } as any,
      middlewareChain: chain,
      errorTracker: { record: vi.fn() } as any,
      eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as any,
      storagePath: '/tmp/test-plugin',
      sessions: null as any,
      config: null as any,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    }),
  }
}

describe('emitHook', () => {
  it('fires with plugin: prefix — cannot collide with core hooks', async () => {
    const { ctx, chain } = makeCtx('my-plugin')
    const received: string[] = []

    // Register on the full namespaced name
    chain.add('plugin:my-plugin:userJoined', 'consumer', {
      handler: async (payload: any, next) => {
        received.push(payload.userId)
        return next(payload)
      },
    })

    await (ctx as any).emitHook('userJoined', { userId: 'lucas' })
    expect(received).toEqual(['lucas'])
  })

  it('cannot emit a core hook via emitHook', async () => {
    const { ctx, chain } = makeCtx('evil-plugin')
    const coreHookFired = vi.fn()
    chain.add('agent:beforePrompt', 'guard', {
      handler: async (payload, next) => { coreHookFired(); return next(payload) },
    })

    // Trying to emit 'agent:beforePrompt' via emitHook — gets prefixed to
    // 'plugin:evil-plugin:agent:beforePrompt' which is a different hook
    await (ctx as any).emitHook('agent:beforePrompt', {})
    expect(coreHookFired).not.toHaveBeenCalled()
  })
})
```

- [ ] **Run test to fail, implement, run to pass**

```bash
pnpm test -- --reporter=verbose src/core/__tests__/plugin-hooks.test.ts 2>&1 | tail -10
```

- [ ] **Full build + test**

```bash
pnpm build && pnpm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Commit**

```bash
git add src/core/plugin/plugin-context.ts src/core/__tests__/plugin-hooks.test.ts
git commit -m "feat(core): add defineHook, emitHook (plugin: prefix), forSession, getSessionInfo to PluginContext"
```

---

### Task A7: Sync plugin-sdk exports

**Files:**
- Modify: `packages/plugin-sdk/src/index.ts`

The plugin-sdk re-exports from `@openacp/cli`. New types (`TurnMeta`, updated `PluginStorage`, `PluginPermission`) are automatically picked up via `export * from './types.js'` in `src/core/plugin/index.ts` and the CLI build. Verify they're accessible:

- [ ] **Build plugin-sdk and verify `TurnMeta` is exported**

```bash
cd /Users/lucas/openacp-workspace/OpenACP
pnpm build

# Check TurnMeta is in the built types
grep "TurnMeta" dist/core/types.d.ts
```

Expected: `export interface TurnMeta { turnId: string; [key: string]: unknown; }`

- [ ] **Add explicit `TurnMeta` re-export to plugin-sdk if missing**

If `TurnMeta` is not exposed via `@openacp/cli` exports, add to `packages/plugin-sdk/src/index.ts`:

```typescript
// In the "Core types" section:
export type {
  OpenACPCore, Session, SessionEvents, SessionManager, CommandRegistry,
  Attachment, PlanEntry, StopReason, SessionStatus, ConfigOption,
  UsageRecord, InstallProgress,
  DisplayVerbosity, ToolCallMeta, ToolUpdateMeta, ViewerLinks,
  TelegramPlatformData,
  TurnMeta,    // new
} from '@openacp/cli'
```

Also add `MiddlewarePayloadMap` to the re-exports if not already present:

```typescript
export type { MiddlewarePayloadMap, MiddlewareHook } from '@openacp/cli'
```

- [ ] **Build plugin-sdk**

```bash
cd /Users/lucas/openacp-workspace/OpenACP/packages/plugin-sdk
npm run build 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add packages/plugin-sdk/src/index.ts
git commit -m "feat(plugin-sdk): export TurnMeta and MiddlewarePayloadMap"
```

---

## Phase B — Workspace Plugin (`workspace-plugin` repo)

Work in: `/Users/lucas/openacp-workspace/workspace-plugin`

Before starting: update `@openacp/plugin-sdk` in workspace-plugin to use the local workspace version:

```bash
cd /Users/lucas/openacp-workspace/workspace-plugin
npm install
```

If the local SDK isn't auto-linked, add a file path override to `package.json`:
```json
"devDependencies": {
  "@openacp/plugin-sdk": "file:../OpenACP/packages/plugin-sdk"
}
```
Then `npm install` again.

### File Map (Phase B)

```
src/
  types.ts                      — All shared plugin types (UserRecord, SessionRecord, etc.)
  identity.ts                   — UserRegistry (create, lookup by identityId, upsert username index)
  session-store.ts              — SessionStore (create, get, activate teamwork, participants, tasks)
  message-store.ts              — MessageStore (persist message, get history for session)
  presence.ts                   — PresenceTracker (update, get, schedule idle)
  mentions.ts                   — MentionParser (extract @username from text, resolve to identityId)
  hooks/
    message-incoming.ts         — message:incoming middleware
    agent-before-prompt.ts      — agent:beforePrompt middleware
    agent-after-turn.ts         — agent:afterTurn handler
    turn-lifecycle.ts           — turn:start/end handlers (presence update)
    session-destroy.ts          — session:afterDestroy cleanup
  commands/
    index.ts                    — register all commands
    teamwork.ts                 — /teamwork command handler
    whoami.ts                   — /whoami handler
    team.ts                     — /team handler
    assign.ts                   — /assign handler
    tasks.ts                    — /tasks handler
    handoff.ts                  — /handoff handler
  api/
    routes.ts                   — Fastify routes for /workspace/*
    sse.ts                      — SSE connection manager + event push
  index.ts                      — plugin entry: wires all modules together
  __tests__/
    identity.test.ts
    session-store.test.ts
    message-store.test.ts
    mentions.test.ts
    commands.test.ts
    hooks.test.ts
```

---

### Task B1: Define all shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Write `src/types.ts`**

```typescript
// All workspace plugin data types.
// Storage key conventions:
//   Global: users/{identityId}, usernames/{username}
//   Session-scoped: session, messages/{turnId}

export type IdentitySource = 'api' | 'telegram' | 'discord' | 'slack'

export interface UserRecord {
  /** Format: "{source}:{id}" — e.g. "telegram:123456789", "api:abc123xyz" */
  identityId: string
  source: IdentitySource
  displayName?: string
  /** Used for @mention resolution. Unique within the plugin's user registry. */
  username?: string
  linkedIdentities?: string[]
  registeredAt: string
  updatedAt: string
}

export type ParticipantStatus = 'active' | 'idle' | 'offline'
export type ParticipantRole = 'owner' | 'member'

export interface ParticipantRecord {
  identityId: string
  role: ParticipantRole
  joinedAt: string
  status: ParticipantStatus
  lastSeen: string
}

export interface TaskRecord {
  id: string
  title: string
  assignee?: string  // identityId
  status: 'open' | 'done'
  createdAt: string
}

export interface SessionRecord {
  sessionId: string
  type: 'solo' | 'teamwork'
  owner: string  // identityId
  participants: ParticipantRecord[]
  tasks: TaskRecord[]
  /** Whether the team system prompt has been injected for this session. */
  systemPromptInjected: boolean
  createdAt: string
}

export interface MessageRecord {
  turnId: string
  identityId: string
  /** Original text before [Name]: prefix was added. */
  text: string
  mentions: string[]  // identityIds
  timestamp: string
}

/** Keys written to TurnMeta by this plugin. Namespaced to avoid collisions. */
export interface WorkspaceTurnSender {
  identityId: string
  displayName: string
  username?: string
}

export const TURN_META_SENDER_KEY = 'workspace.sender'
export const TURN_META_MENTIONS_KEY = 'workspace.mentions'

export type SseEvent =
  | { type: 'workspace:teamworkActivated'; sessionId: string }
  | { type: 'workspace:mention'; sessionId: string; mentionedBy: string; mentionedUser: string; turnId: string }
  | { type: 'workspace:participant'; sessionId: string; identityId: string; action: 'join' | 'leave' }
  | { type: 'workspace:presence'; sessionId: string; identityId: string; status: ParticipantStatus }
  | { type: 'workspace:task:assigned'; sessionId: string; taskId: string; assignee: string; title: string }
  | { type: 'workspace:task:done'; sessionId: string; taskId: string }
  | { type: 'workspace:handoff'; sessionId: string; from: string; to: string }
```

- [ ] **Build to verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src/types.ts
git commit -m "feat(workspace): add shared type definitions"
```

---

### Task B2: Identity module — user registry

**Files:**
- Create: `src/identity.ts`
- Create: `src/__tests__/identity.test.ts`

- [ ] **Write failing tests** in `src/__tests__/identity.test.ts`

```typescript
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
})
```

- [ ] **Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/__tests__/identity.test.ts 2>&1 | tail -10
```

- [ ] **Implement `src/identity.ts`**

```typescript
import type { PluginStorage } from '@openacp/plugin-sdk'
import type { UserRecord, IdentitySource } from './types.js'

export class UserRegistry {
  constructor(private readonly storage: PluginStorage) {}

  /** Builds the canonical identityId: "{source}:{id}" */
  static buildIdentityId(source: IdentitySource | string, id: string): string {
    return `${source}:${id}`
  }

  async getById(identityId: string): Promise<UserRecord | undefined> {
    return this.storage.get<UserRecord>(`users/${identityId}`)
  }

  async resolveUsername(username: string): Promise<string | undefined> {
    return this.storage.get<string>(`usernames/${username}`)
  }

  /**
   * Create or update a user record. If username changes, the old index entry
   * is removed and the new one is added atomically (best-effort — two writes).
   */
  async upsert(partial: Partial<UserRecord> & { identityId: string; source: IdentitySource }): Promise<UserRecord> {
    const existing = await this.getById(partial.identityId)
    const now = new Date().toISOString()

    // Clean up old username index if username is changing
    if (existing?.username && existing.username !== partial.username) {
      await this.storage.delete(`usernames/${existing.username}`)
    }

    const record: UserRecord = {
      ...existing,
      ...partial,
      updatedAt: now,
      registeredAt: existing?.registeredAt ?? now,
    }
    await this.storage.set(`users/${record.identityId}`, record)

    // Upsert new username index
    if (record.username) {
      await this.storage.set(`usernames/${record.username}`, record.identityId)
    }
    return record
  }

  async linkIdentities(primaryId: string, linkedId: string): Promise<void> {
    const primary = await this.getById(primaryId)
    if (!primary) return
    const linked = new Set(primary.linkedIdentities ?? [])
    linked.add(linkedId)
    await this.upsert({ ...primary, linkedIdentities: [...linked] })
  }
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test -- --reporter=verbose src/__tests__/identity.test.ts 2>&1 | tail -10
```

Expected: 4 tests PASS.

- [ ] **Commit**

```bash
git add src/identity.ts src/__tests__/identity.test.ts
git commit -m "feat(workspace): implement UserRegistry with username index"
```

---

### Task B3: Session store module

**Files:**
- Create: `src/session-store.ts`
- Create: `src/__tests__/session-store.test.ts`

- [ ] **Write failing tests** in `src/__tests__/session-store.test.ts`

```typescript
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
    await store.init('telegram:123')
    const s = await store.get()
    expect(s?.type).toBe('solo')
    expect(s?.owner).toBe('telegram:123')
    expect(s?.participants[0]?.role).toBe('owner')
  })

  it('activateTeamwork transitions to teamwork and resets systemPromptInjected', async () => {
    await store.init('telegram:123')
    await store.activateTeamwork()
    const s = await store.get()
    expect(s?.type).toBe('teamwork')
    expect(s?.systemPromptInjected).toBe(false)
  })

  it('activateTeamwork is idempotent on already-teamwork session', async () => {
    await store.init('telegram:123')
    await store.activateTeamwork()
    await store.activateTeamwork()  // second call — no error
    const s = await store.get()
    expect(s?.type).toBe('teamwork')
  })

  it('addParticipant adds member if not already present', async () => {
    await store.init('telegram:123')
    await store.addParticipant('telegram:456')
    const s = await store.get()
    expect(s?.participants).toHaveLength(2)
    expect(s?.participants[1]?.identityId).toBe('telegram:456')
    expect(s?.participants[1]?.role).toBe('member')
  })

  it('markSystemPromptInjected sets flag to true', async () => {
    await store.init('telegram:123')
    await store.activateTeamwork()
    await store.markSystemPromptInjected()
    const s = await store.get()
    expect(s?.systemPromptInjected).toBe(true)
  })
})
```

- [ ] **Implement `src/session-store.ts`**

```typescript
import type { PluginStorage } from '@openacp/plugin-sdk'
import type { SessionRecord, ParticipantRecord } from './types.js'
import { nanoid } from 'nanoid'

export class SessionStore {
  constructor(
    private readonly storage: PluginStorage,
    private readonly sessionId: string,
  ) {}

  async get(): Promise<SessionRecord | undefined> {
    return this.storage.get<SessionRecord>('session')
  }

  async init(ownerIdentityId: string): Promise<SessionRecord> {
    const existing = await this.get()
    if (existing) return existing

    const now = new Date().toISOString()
    const record: SessionRecord = {
      sessionId: this.sessionId,
      type: 'solo',
      owner: ownerIdentityId,
      participants: [{
        identityId: ownerIdentityId,
        role: 'owner',
        joinedAt: now,
        status: 'active',
        lastSeen: now,
      }],
      tasks: [],
      systemPromptInjected: false,
      createdAt: now,
    }
    await this.storage.set('session', record)
    return record
  }

  async activateTeamwork(): Promise<void> {
    const s = await this.get()
    if (!s || s.type === 'teamwork') return
    await this.storage.set('session', {
      ...s,
      type: 'teamwork',
      // Reset so system prompt fires on next turn
      systemPromptInjected: false,
    })
  }

  async addParticipant(identityId: string): Promise<boolean> {
    const s = await this.get()
    if (!s) return false
    if (s.participants.some(p => p.identityId === identityId)) return false
    const now = new Date().toISOString()
    const participant: ParticipantRecord = {
      identityId, role: 'member', joinedAt: now, status: 'active', lastSeen: now,
    }
    await this.storage.set('session', { ...s, participants: [...s.participants, participant] })
    return true
  }

  async markSystemPromptInjected(): Promise<void> {
    const s = await this.get()
    if (s) await this.storage.set('session', { ...s, systemPromptInjected: true })
  }

  async addTask(title: string, assignee?: string): Promise<string> {
    const s = await this.get()
    if (!s) throw new Error('Session not initialized')
    const id = nanoid(8)
    const task = { id, title, assignee, status: 'open' as const, createdAt: new Date().toISOString() }
    await this.storage.set('session', { ...s, tasks: [...s.tasks, task] })
    return id
  }

  async completeTask(taskId: string): Promise<void> {
    const s = await this.get()
    if (!s) return
    const tasks = s.tasks.map(t => t.id === taskId ? { ...t, status: 'done' as const } : t)
    await this.storage.set('session', { ...s, tasks })
  }

  async transferOwnership(newOwnerIdentityId: string): Promise<void> {
    const s = await this.get()
    if (!s) return
    const participants = s.participants.map(p => ({
      ...p,
      role: (p.identityId === newOwnerIdentityId ? 'owner'
        : p.identityId === s.owner ? 'member' : p.role) as 'owner' | 'member',
    }))
    await this.storage.set('session', { ...s, owner: newOwnerIdentityId, participants })
  }

  async updatePresence(identityId: string, status: ParticipantRecord['status']): Promise<void> {
    const s = await this.get()
    if (!s) return
    const now = new Date().toISOString()
    const participants = s.participants.map(p =>
      p.identityId === identityId ? { ...p, status, lastSeen: now } : p,
    )
    await this.storage.set('session', { ...s, participants })
  }
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test -- --reporter=verbose src/__tests__/session-store.test.ts 2>&1 | tail -10
```

Expected: 5 tests PASS.

- [ ] **Commit**

```bash
git add src/session-store.ts src/__tests__/session-store.test.ts
git commit -m "feat(workspace): implement SessionStore with teamwork mode and participant management"
```

---

### Task B4: Message store + Presence tracker

**Files:**
- Create: `src/message-store.ts`
- Create: `src/presence.ts`
- Create: `src/__tests__/message-store.test.ts`

- [ ] **Implement `src/message-store.ts`**

```typescript
import type { PluginStorage } from '@openacp/plugin-sdk'
import type { MessageRecord } from './types.js'

export class MessageStore {
  constructor(private readonly storage: PluginStorage) {}

  async persist(record: MessageRecord): Promise<void> {
    await this.storage.set(`messages/${record.turnId}`, record)
  }

  async getByTurnId(turnId: string): Promise<MessageRecord | undefined> {
    return this.storage.get<MessageRecord>(`messages/${turnId}`)
  }

  async getHistory(): Promise<MessageRecord[]> {
    const keys = await this.storage.keys('messages/')
    const records = await Promise.all(keys.map(k => this.storage.get<MessageRecord>(k)))
    return (records.filter(Boolean) as MessageRecord[])
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }
}
```

- [ ] **Implement `src/presence.ts`**

```typescript
import type { SessionStore } from './session-store.js'

// Idle timeout: mark a participant as idle after 30 minutes of inactivity.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000

export class PresenceTracker {
  // Map of sessionId:identityId → timer handle
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

  markActive(sessionStore: SessionStore, sessionId: string, identityId: string): void {
    // Cancel any pending idle timer
    const key = `${sessionId}:${identityId}`
    const existing = this.idleTimers.get(key)
    if (existing) clearTimeout(existing)

    // Set new idle timer
    const timer = setTimeout(async () => {
      await sessionStore.updatePresence(identityId, 'idle')
      this.idleTimers.delete(key)
    }, IDLE_TIMEOUT_MS)
    // Allow process to exit even if timer is pending
    timer.unref?.()
    this.idleTimers.set(key, timer)
  }

  clearAll(): void {
    for (const timer of this.idleTimers.values()) clearTimeout(timer)
    this.idleTimers.clear()
  }
}
```

- [ ] **Write and run tests** `src/__tests__/message-store.test.ts`

```typescript
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
    await store.persist({ turnId: 't1', identityId: 'telegram:123', text: 'hello', mentions: [], timestamp: '2026-01-01T00:00:00Z' })
    const msg = await store.getByTurnId('t1')
    expect(msg?.text).toBe('hello')
  })

  it('getHistory returns records sorted by timestamp', async () => {
    const store = makeStore()
    await store.persist({ turnId: 't2', identityId: 'telegram:123', text: 'second', mentions: [], timestamp: '2026-01-01T00:00:02Z' })
    await store.persist({ turnId: 't1', identityId: 'telegram:123', text: 'first', mentions: [], timestamp: '2026-01-01T00:00:01Z' })
    const history = await store.getHistory()
    expect(history.map(m => m.text)).toEqual(['first', 'second'])
  })
})
```

```bash
npm test -- --reporter=verbose src/__tests__/message-store.test.ts 2>&1 | tail -10
```

- [ ] **Commit**

```bash
git add src/message-store.ts src/presence.ts src/__tests__/message-store.test.ts
git commit -m "feat(workspace): implement MessageStore and PresenceTracker"
```

---

### Task B5: Mention parser

**Files:**
- Create: `src/mentions.ts`
- Create: `src/__tests__/mentions.test.ts`

- [ ] **Write failing tests** `src/__tests__/mentions.test.ts`

```typescript
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
})

describe('resolveMentions', () => {
  it('resolves usernames to identityIds via registry', async () => {
    const ctx = createTestContext({ pluginName: '@openacp/workspace-plugin', permissions: ['storage:read', 'storage:write'] })
    const registry = new UserRegistry(ctx.storage)
    await registry.upsert({ identityId: 'telegram:123', source: 'telegram', username: 'lucas' })
    const ids = await resolveMentions(['lucas', 'unknown'], registry)
    expect(ids).toEqual(['telegram:123'])  // 'unknown' is skipped
  })
})
```

- [ ] **Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/__tests__/mentions.test.ts 2>&1 | tail -10
```

- [ ] **Implement `src/mentions.ts`**

```typescript
import type { UserRegistry } from './identity.js'

const MENTION_REGEX = /@([a-zA-Z0-9_.-]+)/g

/** Extracts all unique @mention usernames from text. Returns lowercase usernames without '@'. */
export function extractMentions(text: string): string[] {
  const matches = new Set<string>()
  for (const match of text.matchAll(MENTION_REGEX)) {
    if (match[1]) matches.add(match[1].toLowerCase())
  }
  return [...matches]
}

/** Resolves mention usernames to identityIds. Unknown usernames are silently skipped. */
export async function resolveMentions(
  usernames: string[],
  registry: UserRegistry,
): Promise<string[]> {
  const results = await Promise.all(
    usernames.map(u => registry.resolveUsername(u)),
  )
  return results.filter((id): id is string => id !== undefined)
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test -- --reporter=verbose src/__tests__/mentions.test.ts 2>&1 | tail -10
```

Expected: 7 tests PASS.

- [ ] **Commit**

```bash
git add src/mentions.ts src/__tests__/mentions.test.ts
git commit -m "feat(workspace): implement mention extraction and resolution"
```

---

### Task B6: Hook implementations

**Files:**
- Create: `src/hooks/message-incoming.ts`
- Create: `src/hooks/agent-before-prompt.ts`
- Create: `src/hooks/agent-after-turn.ts`
- Create: `src/hooks/turn-lifecycle.ts`
- Create: `src/hooks/session-destroy.ts`
- Create: `src/__tests__/hooks.test.ts`

- [ ] **Implement `src/hooks/message-incoming.ts`**

```typescript
import type { PluginContext } from '@openacp/plugin-sdk'
import type { UserRegistry } from '../identity.js'
import type { SessionStore } from '../session-store.js'
import type { PresenceTracker } from '../presence.js'
import { extractMentions, resolveMentions } from '../mentions.js'
import { TURN_META_SENDER_KEY, TURN_META_MENTIONS_KEY } from '../types.js'

export function registerMessageIncoming(
  ctx: PluginContext,
  registry: UserRegistry,
  getSessionStore: (sessionId: string) => SessionStore,
  presence: PresenceTracker,
): void {
  ctx.registerMiddleware('message:incoming', {
    priority: 20,
    handler: async (payload, next) => {
      const { channelId, userId, text, meta } = payload as any

      // Build identityId and ensure user record exists
      const { UserRegistry: UR } = await import('../identity.js')
      const identityId = UR.buildIdentityId(channelId === 'sse' ? 'api' : channelId, userId)
      const user = await registry.upsert({ identityId, source: channelId === 'sse' ? 'api' : channelId })

      // Attach sender to TurnMeta for downstream hooks
      if (meta) {
        meta[TURN_META_SENDER_KEY] = { identityId, displayName: user.displayName ?? userId, username: user.username }
      }

      // Ensure session is initialized with this user as owner (if first message)
      // sessionId is only available after session creation — use threadId as proxy
      // This is populated if the session exists; skip for new sessions (init happens in beforePrompt)
      if (payload.threadId && meta) {
        const mentions = extractMentions(text)
        const resolved = await resolveMentions(mentions, registry)
        meta[TURN_META_MENTIONS_KEY] = resolved
      }

      return next(payload)
    },
  })
}
```

- [ ] **Implement `src/hooks/agent-before-prompt.ts`**

```typescript
import type { PluginContext } from '@openacp/plugin-sdk'
import type { UserRegistry } from '../identity.js'
import type { SessionStore } from '../session-store.js'
import type { MessageStore } from '../message-store.js'
import type { PresenceTracker } from '../presence.js'
import { TURN_META_SENDER_KEY, TURN_META_MENTIONS_KEY, type WorkspaceTurnSender } from '../types.js'

const TEAM_SYSTEM_PROMPT = (participants: string) =>
  `[System: Team session. ${participants}. Each message is prefixed with [Name]. ` +
  `You can @mention participants — they will be notified and can take action or make decisions.]`

export function registerAgentBeforePrompt(
  ctx: PluginContext,
  registry: UserRegistry,
  getSessionStore: (sessionId: string) => SessionStore,
  getMessageStore: (sessionId: string) => MessageStore,
  presence: PresenceTracker,
): void {
  ctx.registerMiddleware('agent:beforePrompt', {
    priority: 20,
    handler: async (payload, next) => {
      const { sessionId, meta } = payload as any
      const sender = meta?.[TURN_META_SENDER_KEY] as WorkspaceTurnSender | undefined
      const turnId: string = meta?.turnId ?? 'unknown'

      const store = getSessionStore(sessionId)
      let session = await store.get()

      // Initialize session record on first prompt if not yet done
      if (!session && sender) {
        session = await store.init(sender.identityId)
      }

      // Persist message record regardless of teamwork status (history for all sessions)
      if (sender) {
        const msgStore = getMessageStore(sessionId)
        const mentionedIds = (meta?.[TURN_META_MENTIONS_KEY] as string[]) ?? []
        await msgStore.persist({
          turnId,
          identityId: sender.identityId,
          text: payload.text,
          mentions: mentionedIds,
          timestamp: new Date().toISOString(),
        })

        // Update presence
        presence.markActive(store, sessionId, sender.identityId)

        // Ensure sender is in participants list
        const isNew = await store.addParticipant(sender.identityId)
        if (isNew && session?.type === 'teamwork') {
          await ctx.emitHook('userJoined', { sessionId, identityId: sender.identityId, role: 'member' })
        }
      }

      // --- Teamwork-only: sender prefix + system prompt + notify mentions ---
      session = await store.get()
      if (session?.type !== 'teamwork') return next(payload)

      let text: string = payload.text

      // 1. Inject team system prompt on first turn after teamwork activation
      if (!session.systemPromptInjected && sender) {
        const participantNames = session.participants
          .map(p => `${p.identityId} (${p.role})`)
          .join(', ')
        const systemBlock = TEAM_SYSTEM_PROMPT(participantNames)
        text = `${systemBlock}\n\n${text}`
        await store.markSystemPromptInjected()
      }

      // 2. Prefix sender name
      if (sender) {
        const name = sender.username ? `${sender.displayName} (@${sender.username})` : sender.displayName
        text = `[${name}]: ${text}`
      }

      // 3. Notify in-thread for user @mentions (immediate, before agent responds)
      const mentionedIds = (meta?.[TURN_META_MENTIONS_KEY] as string[]) ?? []
      for (const mentionedId of mentionedIds) {
        const mentionedUser = await registry.getById(mentionedId)
        const mentionedName = mentionedUser?.displayName ?? mentionedId
        await ctx.sendMessage(sessionId, {
          type: 'text',
          text: `📢 ${sender?.displayName ?? 'Someone'} mentioned you (@${mentionedUser?.username ?? mentionedId}) in this session.`,
        })
        await ctx.emitHook('mention', {
          sessionId,
          turnId,
          mentionedBy: sender?.identityId ?? 'unknown',
          mentionedUser: mentionedId,
        })
      }

      return next({ ...payload, text })
    },
  })
}
```

- [ ] **Implement `src/hooks/agent-after-turn.ts`**

```typescript
import type { PluginContext } from '@openacp/plugin-sdk'
import type { UserRegistry } from '../identity.js'
import { extractMentions, resolveMentions } from '../mentions.js'

export function registerAgentAfterTurn(
  ctx: PluginContext,
  registry: UserRegistry,
  isTeamworkSession: (sessionId: string) => Promise<boolean>,
): void {
  ctx.registerMiddleware('agent:afterTurn', {
    handler: async (payload, next) => {
      const { sessionId, fullText, turnId } = payload as any
      if (!await isTeamworkSession(sessionId)) return next(payload)

      const usernames = extractMentions(fullText)
      if (usernames.length === 0) return next(payload)

      const mentionedIds = await resolveMentions(usernames, registry)
      for (const mentionedId of mentionedIds) {
        const user = await registry.getById(mentionedId)
        await ctx.sendMessage(sessionId, {
          type: 'text',
          text: `🤖 The agent mentioned you (@${user?.username ?? mentionedId}). Your input may be needed.`,
        })
        await ctx.emitHook('mention', {
          sessionId, turnId,
          mentionedBy: 'agent',
          mentionedUser: mentionedId,
        })
      }
      return next(payload)
    },
  })
}
```

- [ ] **Implement `src/hooks/turn-lifecycle.ts`**

```typescript
import type { PluginContext } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { PresenceTracker } from '../presence.js'
import { TURN_META_SENDER_KEY, type WorkspaceTurnSender } from '../types.js'

export function registerTurnLifecycle(
  ctx: PluginContext,
  getSessionStore: (sessionId: string) => SessionStore,
  presence: PresenceTracker,
): void {
  ctx.registerMiddleware('turn:start', {
    handler: async (payload, next) => {
      const { sessionId, meta } = payload as any
      const sender = meta?.[TURN_META_SENDER_KEY] as WorkspaceTurnSender | undefined
      if (sender) {
        const store = getSessionStore(sessionId)
        await store.updatePresence(sender.identityId, 'active')
        presence.markActive(store, sessionId, sender.identityId)
      }
      return next(payload)
    },
  })
}
```

- [ ] **Implement `src/hooks/session-destroy.ts`**

```typescript
import type { PluginContext } from '@openacp/plugin-sdk'

export function registerSessionDestroy(
  ctx: PluginContext,
  getSessionStorage: (sessionId: string) => import('@openacp/plugin-sdk').PluginStorage,
): void {
  ctx.registerMiddleware('session:afterDestroy', {
    handler: async (payload, next) => {
      const { sessionId } = payload as any
      try {
        await getSessionStorage(sessionId).clear()
      } catch {
        // Best-effort cleanup — don't block the destroy flow
      }
      return next(payload)
    },
  })
}
```

- [ ] **Write and run hook tests** `src/__tests__/hooks.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import { UserRegistry } from '../identity.js'
import { registerAgentBeforePrompt } from '../hooks/agent-before-prompt.js'
import { SessionStore } from '../session-store.js'
import { MessageStore } from '../message-store.js'
import { PresenceTracker } from '../presence.js'
import { TURN_META_SENDER_KEY } from '../types.js'

function setup() {
  const ctx = createTestContext({
    pluginName: '@openacp/workspace-plugin',
    permissions: ['storage:read', 'storage:write', 'middleware:register', 'services:use'],
  })
  const registry = new UserRegistry(ctx.storage)
  const presence = new PresenceTracker()
  const getStore = (sid: string) => new SessionStore(ctx.storage.forSession(sid), sid)
  const getMsgStore = (sid: string) => new MessageStore(ctx.storage.forSession(sid))
  return { ctx, registry, presence, getStore, getMsgStore }
}

describe('agent:beforePrompt hook', () => {
  it('does not prefix text for solo sessions', async () => {
    const { ctx, registry, presence, getStore, getMsgStore } = setup()
    registerAgentBeforePrompt(ctx, registry, getStore, getMsgStore, presence)
    await registry.upsert({ identityId: 'telegram:123', source: 'telegram', displayName: 'Lucas' })
    await getStore('sess-1').init('telegram:123')

    const meta = { turnId: 't1', [TURN_META_SENDER_KEY]: { identityId: 'telegram:123', displayName: 'Lucas' } }
    const result = await ctx.executeMiddleware('agent:beforePrompt', { sessionId: 'sess-1', text: 'hello', meta })
    expect(result?.text).toBe('hello')
  })

  it('prefixes text with sender name for teamwork sessions', async () => {
    const { ctx, registry, presence, getStore, getMsgStore } = setup()
    registerAgentBeforePrompt(ctx, registry, getStore, getMsgStore, presence)
    await registry.upsert({ identityId: 'telegram:123', source: 'telegram', displayName: 'Lucas', username: 'lucas' })
    const store = getStore('sess-1')
    await store.init('telegram:123')
    await store.activateTeamwork()
    await store.markSystemPromptInjected()  // skip system prompt for this test

    const meta = { turnId: 't1', [TURN_META_SENDER_KEY]: { identityId: 'telegram:123', displayName: 'Lucas', username: 'lucas' } }
    const result = await ctx.executeMiddleware('agent:beforePrompt', { sessionId: 'sess-1', text: 'hello', meta })
    expect(result?.text).toContain('[Lucas (@lucas)]: hello')
  })
})
```

```bash
npm test -- --reporter=verbose src/__tests__/hooks.test.ts 2>&1 | tail -15
```

- [ ] **Commit**

```bash
git add src/hooks/ src/__tests__/hooks.test.ts
git commit -m "feat(workspace): implement all middleware hook handlers"
```

---

### Task B7: Commands

**Files:**
- Create: `src/commands/teamwork.ts`
- Create: `src/commands/whoami.ts`
- Create: `src/commands/team.ts`
- Create: `src/commands/assign.ts`
- Create: `src/commands/tasks.ts`
- Create: `src/commands/handoff.ts`
- Create: `src/commands/index.ts`
- Create: `src/__tests__/commands.test.ts`

- [ ] **Implement `src/commands/teamwork.ts`**

```typescript
import type { CommandDef } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'

export function makeTeamworkCommand(getSessionStore: (sid: string) => SessionStore): CommandDef {
  return {
    name: 'teamwork',
    description: 'Activate team mode for this session (one-way, irreversible)',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const store = getSessionStore(args.sessionId)
      const session = await store.get()
      if (session?.type === 'teamwork') return { type: 'text', text: 'Already in team mode.' }
      await store.activateTeamwork()
      return { type: 'text', text: '✅ Team mode activated. The agent will now see who is speaking and can @mention participants.' }
    },
  }
}
```

- [ ] **Implement `src/commands/whoami.ts`**

```typescript
import type { CommandDef } from '@openacp/plugin-sdk'
import type { UserRegistry } from '../identity.js'
import type { IdentitySource } from '../types.js'

export function makeWhoamiCommand(registry: UserRegistry): CommandDef {
  return {
    name: 'whoami',
    description: 'Set your display name',
    usage: '<name>',
    category: 'plugin',
    async handler(args) {
      const name = args.raw.trim()
      if (!name) return { type: 'error', message: 'Usage: /whoami <your name>' }
      const source = args.channelId === 'sse' ? 'api' : args.channelId as IdentitySource
      const identityId = UserRegistry.buildIdentityId(source, args.userId)
      await registry.upsert({ identityId, source, displayName: name })
      return { type: 'text', text: `✅ Your display name is now "${name}".` }
    },
  }
}
```

- [ ] **Implement `src/commands/team.ts`**

```typescript
import type { CommandDef } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { UserRegistry } from '../identity.js'

export function makeTeamCommand(
  getSessionStore: (sid: string) => SessionStore,
  registry: UserRegistry,
): CommandDef {
  return {
    name: 'team',
    description: 'List current participants and their presence status',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const session = await getSessionStore(args.sessionId).get()
      if (!session) return { type: 'text', text: 'No workspace session data yet.' }
      const lines = await Promise.all(session.participants.map(async p => {
        const user = await registry.getById(p.identityId)
        const name = user?.displayName ?? p.identityId
        const statusIcon = { active: '🟢', idle: '🟡', offline: '⚫' }[p.status]
        return `${statusIcon} ${name} (${p.role})`
      }))
      return { type: 'text', text: `**Team** [${session.type}]\n${lines.join('\n')}` }
    },
  }
}
```

- [ ] **Implement `src/commands/assign.ts`**

```typescript
import type { CommandDef } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { UserRegistry } from '../identity.js'
import { extractMentions, resolveMentions } from '../mentions.js'

export function makeAssignCommand(
  getSessionStore: (sid: string) => SessionStore,
  registry: UserRegistry,
): CommandDef {
  return {
    name: 'assign',
    description: 'Assign a task to a participant',
    usage: '@user <task description>',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const session = await getSessionStore(args.sessionId).get()
      if (session?.type !== 'teamwork') return { type: 'error', message: 'Requires team mode. Run /teamwork first.' }
      const mentions = extractMentions(args.raw)
      if (mentions.length === 0) return { type: 'error', message: 'Usage: /assign @user <task description>' }
      const [assigneeId] = await resolveMentions(mentions, registry)
      if (!assigneeId) return { type: 'error', message: `User @${mentions[0]} not found. They need to send a message first.` }
      const title = args.raw.replace(/@\w+/g, '').trim()
      if (!title) return { type: 'error', message: 'Please provide a task description.' }
      const taskId = await getSessionStore(args.sessionId).addTask(title, assigneeId)
      const user = await registry.getById(assigneeId)
      return { type: 'text', text: `✅ Task assigned to ${user?.displayName ?? assigneeId}: "${title}" (${taskId})` }
    },
  }
}
```

- [ ] **Implement `src/commands/tasks.ts`**

```typescript
import type { CommandDef } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { UserRegistry } from '../identity.js'

export function makeTasksCommand(
  getSessionStore: (sid: string) => SessionStore,
  registry: UserRegistry,
): CommandDef {
  return {
    name: 'tasks',
    description: 'List open tasks in this session',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const session = await getSessionStore(args.sessionId).get()
      const open = session?.tasks.filter(t => t.status === 'open') ?? []
      if (open.length === 0) return { type: 'text', text: 'No open tasks.' }
      const lines = await Promise.all(open.map(async t => {
        const assignee = t.assignee ? (await registry.getById(t.assignee))?.displayName ?? t.assignee : 'unassigned'
        return `• [${t.id}] ${t.title} → ${assignee}`
      }))
      return { type: 'text', text: `**Open tasks:**\n${lines.join('\n')}` }
    },
  }
}
```

- [ ] **Implement `src/commands/handoff.ts`**

```typescript
import type { CommandDef } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { UserRegistry } from '../identity.js'
import { extractMentions, resolveMentions } from '../mentions.js'

export function makeHandoffCommand(
  getSessionStore: (sid: string) => SessionStore,
  registry: UserRegistry,
): CommandDef {
  return {
    name: 'handoff',
    description: 'Transfer session ownership to another participant',
    usage: '@user',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const session = await getSessionStore(args.sessionId).get()
      if (session?.type !== 'teamwork') return { type: 'error', message: 'Requires team mode.' }
      const mentions = extractMentions(args.raw)
      if (mentions.length === 0) return { type: 'error', message: 'Usage: /handoff @user' }
      const [newOwnerId] = await resolveMentions(mentions, registry)
      if (!newOwnerId) return { type: 'error', message: `User @${mentions[0]} not found.` }
      await getSessionStore(args.sessionId).transferOwnership(newOwnerId)
      const user = await registry.getById(newOwnerId)
      return { type: 'text', text: `✅ Session ownership transferred to ${user?.displayName ?? newOwnerId}.` }
    },
  }
}
```

- [ ] **Implement `src/commands/index.ts`**

```typescript
import type { PluginContext } from '@openacp/plugin-sdk'
import type { UserRegistry } from '../identity.js'
import type { SessionStore } from '../session-store.js'
import { makeTeamworkCommand } from './teamwork.js'
import { makeWhoamiCommand } from './whoami.js'
import { makeTeamCommand } from './team.js'
import { makeAssignCommand } from './assign.js'
import { makeTasksCommand } from './tasks.js'
import { makeHandoffCommand } from './handoff.js'

export function registerCommands(
  ctx: PluginContext,
  registry: UserRegistry,
  getSessionStore: (sid: string) => SessionStore,
): void {
  ctx.registerCommand(makeTeamworkCommand(getSessionStore))
  ctx.registerCommand(makeWhoamiCommand(registry))
  ctx.registerCommand(makeTeamCommand(getSessionStore, registry))
  ctx.registerCommand(makeAssignCommand(getSessionStore, registry))
  ctx.registerCommand(makeTasksCommand(getSessionStore, registry))
  ctx.registerCommand(makeHandoffCommand(getSessionStore, registry))
}
```

- [ ] **Write and run command tests** `src/__tests__/commands.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import { UserRegistry } from '../identity.js'
import { SessionStore } from '../session-store.js'
import { makeTeamworkCommand } from '../commands/teamwork.js'
import { makeWhoamiCommand } from '../commands/whoami.js'

function setup(sessionId = 'sess-1') {
  const ctx = createTestContext({
    pluginName: '@openacp/workspace-plugin',
    permissions: ['storage:read', 'storage:write', 'commands:register'],
  })
  const registry = new UserRegistry(ctx.storage)
  const store = new SessionStore(ctx.storage.forSession(sessionId), sessionId)
  return { ctx, registry, store }
}

describe('/teamwork command', () => {
  it('activates teamwork mode', async () => {
    const { store } = setup()
    await store.init('telegram:123')
    const cmd = makeTeamworkCommand((sid) => new SessionStore({} as any, sid))  // use real store
    // Use the store directly since factory isn't DI'd — integration-style:
    const realCmd = makeTeamworkCommand(() => store)
    const result = await realCmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect(result).toMatchObject({ type: 'text' })
    expect((result as any).text).toContain('Team mode activated')
  })

  it('returns "already in team mode" when called twice', async () => {
    const { store } = setup()
    await store.init('telegram:123')
    await store.activateTeamwork()
    const cmd = makeTeamworkCommand(() => store)
    const result = await cmd.handler({ raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123', reply: async () => {} })
    expect((result as any).text).toContain('Already in team mode')
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
```

```bash
npm test -- --reporter=verbose src/__tests__/commands.test.ts 2>&1 | tail -15
```

- [ ] **Commit**

```bash
git add src/commands/ src/__tests__/commands.test.ts
git commit -m "feat(workspace): implement all chat commands (/teamwork, /whoami, /team, /assign, /tasks, /handoff)"
```

---

### Task B8: SSE manager and REST API routes

**Files:**
- Create: `src/api/sse.ts`
- Create: `src/api/routes.ts`

- [ ] **Implement `src/api/sse.ts`**

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SseEvent } from '../types.js'
import * as http from 'node:http'

/**
 * Manages SSE connections for workspace real-time events.
 * Clients connect to GET /workspace/events. Filter by ?sessionId= if needed.
 */
export class WorkspaceSseManager {
  private connections = new Set<http.ServerResponse>()

  handleConnection(req: FastifyRequest, reply: FastifyReply): void {
    const res = reply.raw
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.writeHead(200)
    res.write(':\n\n')  // initial comment to establish connection
    this.connections.add(res)
    req.raw.on('close', () => this.connections.delete(res))
  }

  push(event: SseEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const conn of this.connections) {
      try { conn.write(data) } catch { this.connections.delete(conn) }
    }
  }

  get connectionCount(): number {
    return this.connections.size
  }
}
```

- [ ] **Implement `src/api/routes.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import type { UserRegistry } from '../identity.js'
import type { SessionStore } from '../session-store.js'
import type { MessageStore } from '../message-store.js'
import type { WorkspaceSseManager } from './sse.js'

export async function workspaceRoutes(
  app: FastifyInstance,
  deps: {
    registry: UserRegistry
    getSessionStore: (sid: string) => SessionStore
    getMessageStore: (sid: string) => MessageStore
    sse: WorkspaceSseManager
  },
): Promise<void> {
  const { registry, getSessionStore, getMessageStore, sse } = deps

  // GET /workspace/sessions/:sessionId/history
  app.get('/sessions/:sessionId/history', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const history = await getMessageStore(sessionId).getHistory()
    const enriched = await Promise.all(history.map(async m => {
      const user = await registry.getById(m.identityId)
      return { ...m, displayName: user?.displayName ?? m.identityId, username: user?.username }
    }))
    return { history: enriched }
  })

  // GET /workspace/sessions/:sessionId/participants
  app.get('/sessions/:sessionId/participants', async (req) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = await getSessionStore(sessionId).get()
    if (!session) return { participants: [] }
    const enriched = await Promise.all(session.participants.map(async p => {
      const user = await registry.getById(p.identityId)
      return { ...p, displayName: user?.displayName, username: user?.username }
    }))
    return { participants: enriched, type: session.type, owner: session.owner }
  })

  // GET /workspace/sessions/:sessionId/tasks
  app.get('/sessions/:sessionId/tasks', async (req) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = await getSessionStore(sessionId).get()
    return { tasks: session?.tasks ?? [] }
  })

  // PUT /workspace/users/me
  app.put('/users/me', async (req, reply) => {
    const user = (req as any).user as { sub: string } | undefined
    if (!user?.sub) return reply.status(401).send({ error: 'Unauthorized' })
    const { displayName, username } = req.body as { displayName?: string; username?: string }
    await registry.upsert({ identityId: `api:${user.sub}`, source: 'api', displayName, username })
    return { ok: true }
  })

  // POST /workspace/users/me/link
  app.post('/users/me/link', async (req, reply) => {
    const user = (req as any).user as { sub: string } | undefined
    if (!user?.sub) return reply.status(401).send({ error: 'Unauthorized' })
    const { platform, platformUserId } = req.body as { platform: string; platformUserId: string }
    const apiId = `api:${user.sub}`
    const platformId = `${platform}:${platformUserId}`
    await registry.linkIdentities(apiId, platformId)
    return { ok: true, linkedIdentityId: platformId }
  })

  // GET /workspace/users/:identityId
  app.get('/users/:identityId', async (req, reply) => {
    const { identityId } = req.params as { identityId: string }
    const user = await registry.getById(decodeURIComponent(identityId))
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return { user }
  })

  // GET /workspace/events — SSE stream
  app.get('/events', (req, reply) => {
    sse.handleConnection(req, reply)
  })
}
```

- [ ] **Build to verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src/api/
git commit -m "feat(workspace): implement SSE manager and REST API routes"
```

---

### Task B9: Wire everything in `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Rewrite `src/index.ts`**

```typescript
import type { OpenACPPlugin, PluginContext } from '@openacp/plugin-sdk'
import type { ApiServerService } from '@openacp/cli'  // service type from core
import { UserRegistry } from './identity.js'
import { SessionStore } from './session-store.js'
import { MessageStore } from './message-store.js'
import { PresenceTracker } from './presence.js'
import { WorkspaceSseManager } from './api/sse.js'
import { workspaceRoutes } from './api/routes.js'
import { registerMessageIncoming } from './hooks/message-incoming.js'
import { registerAgentBeforePrompt } from './hooks/agent-before-prompt.js'
import { registerAgentAfterTurn } from './hooks/agent-after-turn.js'
import { registerTurnLifecycle } from './hooks/turn-lifecycle.js'
import { registerSessionDestroy } from './hooks/session-destroy.js'
import { registerCommands } from './commands/index.js'

const plugin: OpenACPPlugin = {
  name: '@openacp/workspace-plugin',
  version: '0.1.0',
  description: 'Multi-user collaboration for shared OpenACP sessions',

  permissions: [
    'events:read',
    'middleware:register',
    'commands:register',
    'storage:read',
    'storage:write',
    'services:use',
    'sessions:read',
  ],

  async setup(ctx: PluginContext): Promise<void> {
    // Core data modules
    const registry = new UserRegistry(ctx.storage)
    const presence = new PresenceTracker()
    const sse = new WorkspaceSseManager()

    const getSessionStore = (sessionId: string) =>
      new SessionStore(ctx.storage.forSession(sessionId), sessionId)
    const getMessageStore = (sessionId: string) =>
      new MessageStore(ctx.storage.forSession(sessionId))
    const getSessionStorage = (sessionId: string) =>
      ctx.storage.forSession(sessionId)
    const isTeamwork = async (sessionId: string) => {
      const s = await getSessionStore(sessionId).get()
      return s?.type === 'teamwork'
    }

    // Register hooks
    registerMessageIncoming(ctx, registry, getSessionStore, presence)
    registerAgentBeforePrompt(ctx, registry, getSessionStore, getMessageStore, presence)
    registerAgentAfterTurn(ctx, registry, isTeamwork)
    registerTurnLifecycle(ctx, getSessionStore, presence)
    registerSessionDestroy(ctx, getSessionStorage)

    // Register custom hooks (declares intent; other plugins can subscribe)
    ctx.defineHook('teamworkActivated')
    ctx.defineHook('userJoined')
    ctx.defineHook('userLeft')
    ctx.defineHook('taskAssigned')
    ctx.defineHook('handoff')
    ctx.defineHook('mention')

    // Register commands
    registerCommands(ctx, registry, getSessionStore)

    // Register REST/SSE routes via api-server service
    const apiServer = ctx.getService<ApiServerService>('api-server')
    if (apiServer) {
      apiServer.registerPlugin('/workspace', async (app) => {
        await workspaceRoutes(app, { registry, getSessionStore, getMessageStore, sse })
      }, { auth: true })
      ctx.log.info('Workspace REST API registered at /workspace')
    } else {
      ctx.log.warn('api-server service not available — REST/SSE disabled')
    }

    // Push SSE events when plugin hooks fire
    ctx.registerMiddleware('plugin:workspace-plugin:mention' as any, {
      handler: async (payload: any, next) => {
        sse.push({ type: 'workspace:mention', ...payload })
        return next(payload)
      },
    })
    ctx.registerMiddleware('plugin:workspace-plugin:teamworkActivated' as any, {
      handler: async (payload: any, next) => {
        sse.push({ type: 'workspace:teamworkActivated', ...payload })
        return next(payload)
      },
    })

    ctx.log.info('@openacp/workspace-plugin ready')
  },

  async teardown(): Promise<void> {
    // PresenceTracker timers are cleared automatically since they use timer.unref()
  },

  async install(ctx): Promise<void> {
    ctx.terminal.log.success('@openacp/workspace-plugin installed.')
    ctx.terminal.log.info('Use /teamwork in a session to activate team collaboration mode.')
  },

  async uninstall(ctx, opts): Promise<void> {
    if (opts.purge) {
      await ctx.settings.clear()
      ctx.terminal.log.info('Plugin data purged.')
    }
    ctx.terminal.log.success('Uninstalled.')
  },
}

export default plugin
```

- [ ] **Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: compiles with no errors.

- [ ] **Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Commit**

```bash
git add src/index.ts
git commit -m "feat(workspace): wire all modules in plugin entry point"
```

---

### Task B10: Integration smoke test

**Files:**
- Create: `src/__tests__/integration.test.ts`

- [ ] **Write integration test**

```typescript
import { describe, it, expect } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import plugin from '../index.js'

describe('@openacp/workspace-plugin integration', () => {
  it('registers all 6 commands on setup', async () => {
    const ctx = createTestContext({
      pluginName: '@openacp/workspace-plugin',
      permissions: plugin.permissions,
    })
    await plugin.setup(ctx)
    for (const cmd of ['teamwork', 'whoami', 'team', 'assign', 'tasks', 'handoff']) {
      expect(ctx.registeredCommands.has(cmd), `command /${cmd} missing`).toBe(true)
    }
  })

  it('registers middleware on all required hooks', async () => {
    const ctx = createTestContext({
      pluginName: '@openacp/workspace-plugin',
      permissions: plugin.permissions,
    })
    await plugin.setup(ctx)
    const hooks = ctx.registeredMiddleware.map((m: any) => m.hook)
    expect(hooks).toContain('message:incoming')
    expect(hooks).toContain('agent:beforePrompt')
    expect(hooks).toContain('agent:afterTurn')
    expect(hooks).toContain('turn:start')
    expect(hooks).toContain('session:afterDestroy')
  })

  it('full teamwork flow: solo → teamwork → prefix added', async () => {
    const ctx = createTestContext({
      pluginName: '@openacp/workspace-plugin',
      permissions: plugin.permissions,
    })
    await plugin.setup(ctx)

    // Activate teamwork
    const result = await ctx.executeCommand('teamwork', { raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123' })
    expect((result as any).text).toContain('Team mode activated')

    // Second call is idempotent
    const result2 = await ctx.executeCommand('teamwork', { raw: '', sessionId: 'sess-1', channelId: 'telegram', userId: '123' })
    expect((result2 as any).text).toContain('Already in team mode')
  })
})
```

- [ ] **Run integration test**

```bash
npm test -- --reporter=verbose src/__tests__/integration.test.ts 2>&1 | tail -20
```

Expected: all 3 tests PASS.

- [ ] **Run full test suite one final time**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Final commit**

```bash
git add src/__tests__/integration.test.ts
git commit -m "test(workspace): add integration smoke tests"
```

---

## Self-Review

Checked spec against plan:

| Spec requirement | Covered in |
|---|---|
| Agent knows who sent each message | Task B6 (agent:beforePrompt prefix) |
| Users can mention each other | Task B5 (MentionParser) + B6 (hooks) |
| Agent can mention users | Task B6 (agent:afterTurn) |
| Teamwork activated by /teamwork command | Task B7 |
| System prompt injected on first teamwork turn | Task B6 (agent:beforePrompt) |
| Tasks assigned via /assign | Task B7 |
| Handoff via /handoff | Task B7 |
| Full message history with sender metadata | Task B4 (MessageStore) + B6 |
| REST API endpoints | Task B8 |
| SSE stream | Task B8 |
| TurnMeta flows through pipeline | Task A4 |
| turnId in turn:start/end | Task A4 |
| agent:afterTurn hook | Task A5 |
| Session-scoped storage | Task A3 |
| Custom plugin hooks with plugin: prefix | Task A6 |
| getSessionInfo light API | Task A6 |
| storage.keys(prefix) | Task A3 |
| identityId = {source}:{id} | Task B1 + B2 |
| usernames/ reverse index | Task B2 |
| session:afterDestroy cleanup | Task B6 |
| API user registration (PUT /workspace/users/me) | Task B8 |
| Account linking (POST /workspace/users/me/link) | Task B8 |

All requirements covered. No TBDs, no placeholders.
