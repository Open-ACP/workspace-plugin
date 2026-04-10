# @openacp/workspace-plugin — Design Spec

**Date:** 2026-04-11
**Status:** Approved

---

## Overview

`@openacp/workspace-plugin` is a standalone OpenACP plugin that enables multi-user collaboration within a shared session. Without it, the agent has no awareness of who is sending messages when multiple people share a session. This plugin provides identity, presence, mentions, task assignment, handoff, and message history — all managed entirely within the plugin.

This spec also covers required OpenACP core changes needed to make the plugin system flexible enough to support this and future plugins.

---

## Goals

- Agent knows who sent each message in a shared session
- Users can mention each other (and the agent can mention users) to trigger notifications
- Session can be marked as a teamwork session with a team-aware system prompt
- Tasks can be assigned to participants; ownership can be handed off
- Full message history stored with sender metadata
- REST API and SSE stream exposed for app/remote integration

**Non-goals (v1):**
- Direct messages / DMs to users (v2)
- Platform-specific rich notifications (v2)
- Native permission integration (v2)

---

## Part 1 — Core Changes Required

These changes are small, backward-compatible improvements to OpenACP core that benefit the entire plugin ecosystem. The workspace plugin depends on them.

### 1.1 Per-Turn Context Bag (`TurnMeta`)

**Problem:** `message:incoming` and `agent:beforePrompt` are separate middleware invocations — data cannot flow between them. Plugins that enrich context early (e.g., resolve user identity at `message:incoming`) have no way to pass that data to later hooks in the same turn.

**Solution:** Create a `TurnMeta` object alongside `turnId` in `core.ts`, and carry it through all turn-lifecycle hooks. Core fills in `turnId`; plugins can write any additional keys.

```typescript
// core/types.ts — new type
export interface TurnMeta {
  turnId: string
  [key: string]: unknown  // plugins attach whatever they need
}
```

**Implementation:**
- Move `turnId = nanoid(8)` in `core.ts` to BEFORE `message:incoming` middleware executes (currently line 464, after line 393)
- Create `meta: TurnMeta = { turnId }` at the same point
- Add `meta: TurnMeta` to the following hook payloads in `MiddlewarePayloadMap`:
  - `message:incoming`
  - `agent:beforePrompt`
  - `turn:start`
  - `turn:end`
  - `agent:afterTurn` (new — see 1.3)
- Pass `meta` through `session.enqueuePrompt()` as a new optional parameter

**Result:** Plugin A writes `meta.sender = { displayName: 'Lucas' }` at `message:incoming`; Plugin B reads `meta.sender` at `agent:beforePrompt` without any coupling between A and B.

---

### 1.2 `turnId` in Turn Hook Payloads

**Problem:** `turn:start` and `turn:end` payloads do not include `turnId`, making it impossible for plugins to correlate turn lifecycle events with the originating message.

**Solution:** Expose `turnId` explicitly in `turn:start` and `turn:end` payloads. This is solved implicitly by Change 1.1 (`meta.turnId`), but also added as a first-class typed field for clarity.

```typescript
// plugin/types.ts — updated payloads
'turn:start': {
  sessionId: string
  promptText: string
  promptNumber: number
  turnId: string    // new
  meta: TurnMeta    // new
}
'turn:end': {
  sessionId: string
  stopReason: StopReason
  durationMs: number
  turnId: string    // new
  meta: TurnMeta    // new
}
```

**Implementation:** Pass `activeTurnContext.turnId` when firing `TURN_START` and `TURN_END` hooks in `session.ts`.

---

### 1.3 `agent:afterTurn` Hook (New)

**Problem:** `agent:afterEvent` passes a dummy `outgoingMessage: { type: 'text', text: '' }` that is always empty. Plugins that need to read the agent's full assembled response (e.g., to detect `@mentions`) have no reliable hook.

**Solution:** Add a new read-only `agent:afterTurn` hook that fires after the entire turn completes, with the full assembled text response.

```typescript
// plugin/types.ts — new hook
'agent:afterTurn': {
  sessionId: string
  turnId: string
  fullText: string        // complete response, assembled from all text events
  stopReason: StopReason
  meta: TurnMeta
}
```

**Implementation:**
- In `session.ts`, buffer text-type `AgentEvent`s during a turn into a string accumulator
- After `TURN_END` fires, fire `AGENT_AFTER_TURN` with the accumulated `fullText`
- `turnId` must be captured from `activeTurnContext` before it is cleared (line 384 session.ts clears it)
- Read-only hook (cannot block or modify)

---

### 1.4 Session-Scoped Plugin Storage

**Problem:** Plugin storage is global per-plugin (`kv.json`). Plugins tracking per-session state must manually namespace keys (`session:{id}:xxx`) and manually clean up on session destroy — creating disk leak risk.

**Solution:** Add `storage.forSession(sessionId)` that returns a scoped `PluginStorage` instance backed by a separate file.

```typescript
// plugin-storage.ts — new method
forSession(sessionId: string): PluginStorage
// Returns PluginStorageImpl at: baseDir/sessions/{sessionId}/kv.json
```

```typescript
// plugin-context.ts — exposed on ctx.storage
storage.forSession(sessionId: string): PluginStorage
```

**Cleanup is the plugin's responsibility.** Core does not auto-delete session storage — plugins register a `session:afterDestroy` handler to clean up their own scoped data:

```typescript
ctx.registerMiddleware(Hook.SESSION_AFTER_DESTROY, {
  handler: async ({ sessionId }) => {
    const s = ctx.storage.forSession(sessionId)
    await s.clear()
    return null
  }
})
```

---

### 1.5 Custom Plugin Hooks

**Problem:** Plugins cannot define their own hook points for other plugins to consume. A workspace plugin cannot emit a `userJoined` event that an auth plugin can intercept.

**Solution:** Expose `ctx.defineHook()` and `ctx.emitHook()`. Core auto-prefixes all custom hook names with `plugin:{pluginName}:` — a fixed namespace that is structurally separate from all core hooks (which never start with `plugin:`).

```typescript
// plugin-context.ts — new methods
ctx.defineHook(name: string): void
// Registers 'plugin:{pluginName}:{name}' in the middleware chain namespace

ctx.emitHook<T extends Record<string, unknown>>(
  name: string,
  payload: T
): Promise<T | null>
// Fires 'plugin:{pluginName}:{name}' through the middleware chain
// Core always prepends 'plugin:{pluginName}:' — structurally impossible
// for a plugin to collide with core hooks (e.g. 'agent:beforePrompt')
```

```typescript
// Subscribing to another plugin's hook uses the full namespaced name:
ctx.registerMiddleware('plugin:workspace:userJoined', { handler: async (payload, next) => { ... } })
```

**Security:** Core hooks follow the pattern `{domain}:{event}` (e.g. `agent:beforePrompt`). Plugin hooks always start with `plugin:` — a prefix core hooks never use. This makes namespace collision structurally impossible, not just convention-enforced.

---

### 1.6 Session Info Light API

**Problem:** Plugins need `kernel:access` (a powerful permission) just to read basic session metadata like name or status.

**Solution:** Add a `sessions:read` permission and a lightweight `ctx.getSessionInfo()` method that returns a safe, read-only subset of session state.

```typescript
// plugin-context.ts — new method (requires 'sessions:read' permission)
ctx.getSessionInfo(sessionId: string): Promise<{
  id: string
  status: SessionStatus
  name?: string
  promptCount: number
  channelId: string
  agentName: string
} | undefined>
```

---

### 1.7 Storage Prefix Query

**Problem:** `storage.list()` returns all keys; plugins must filter manually. Per-session scoped storage (1.4) amplifies this problem.

**Solution:** Add `storage.keys(prefix?)` as an efficient filtered list.

```typescript
// PluginStorage interface — new method
keys(prefix?: string): Promise<string[]>
// Returns keys matching the prefix. Without prefix, equivalent to list().
```

**Implementation:** Single-line addition in `PluginStorageImpl`: filter `Object.keys(kv)` by prefix.

---

## Part 2 — Workspace Plugin Design

### Architecture

- **Zero adapter changes** — works with existing Telegram, Discord, Slack adapters
- **Data**: `ctx.storage` (global for user registry) + `ctx.storage.forSession()` (session-scoped)
- **Hooks**: OpenACP middleware hooks (core + custom plugin hooks via Change 1.5)
- **API**: Routes registered via `api-server` service's `registerPlugin()`
- **SSE**: Own `/workspace/events` endpoint for real-time events to App clients
- **Identity**: Unified user registry; `identityId = "{source}:{id}"` format for all users

---

### Data Model

```
Global storage (ctx.storage):
  users/{identityId}
    identityId: string          // format: "{source}:{id}"
                                //   e.g. "telegram:123456789", "api:abc123xyz", "discord:987654321"
    source: "api" | "telegram" | "discord" | "slack"
    displayName?: string
    username?: string           // used for @mention resolution
    linkedIdentities?: string[] // cross-platform links, e.g. ["telegram:123456789"]
    registeredAt: string
    updatedAt: string

  usernames/{username}          // reverse index for fast @mention resolution
    identityId: string          //   e.g. usernames/lucas → "telegram:123456789"

Session-scoped storage (ctx.storage.forSession(sessionId)):
  session
    sessionId: string
    type: "solo" | "teamwork"   // solo by default; activated via /teamwork (one-way, irreversible)
    owner: string               // identityId — set on first message:incoming for this session
    participants: Array<{
      identityId: string
      role: "owner" | "member"
      joinedAt: string
      status: "active" | "idle" | "offline"
      lastSeen: string
    }>
    tasks: Array<{
      id: string
      title: string
      assignee?: string         // identityId
      status: "open" | "done"
      createdAt: string
    }>
    systemPromptInjected: boolean  // flag: whether first-turn team system prompt has been sent
    createdAt: string

  messages/{turnId}
    turnId: string              // join key via TurnMeta.turnId
    identityId: string
    text: string                // original text before [Name]: prefix
    mentions: string[]          // identityIds mentioned in this message
    timestamp: string
```

**`identityId` format:** Always `{source}:{id}` — collision between identity spaces is structurally impossible. Telegram IDs (`telegram:123456789`) can never collide with API token subs (`api:abc123xyz`).

**Join pattern:**
- `TurnMeta.turnId` links `messages/{turnId}` to core turn lifecycle
- `sessionId` from hook payloads links to the session record
- `identityId` links participants and messages to global user records
- `usernames/{username}` index enables O(1) `@mention` resolution without scanning all users

---

### Identity Resolution

**From adapter messages (`message:incoming`):**
- `channelId` = source (e.g. `"telegram"`), `userId` = platform user ID
- `identityId = "{channelId}:{userId}"` (e.g. `"telegram:123456789"`)

**From API/App messages (`message:incoming`):**
- `channelId` = `"api"` or `"sse"`, `userId` = `token.sub`
- `identityId = "api:{token.sub}"`

**Linking accounts:** `POST /workspace/users/me/link` stores `linkedIdentities` on both records, enabling mention resolution to find the right person regardless of which platform they're on.

---

### Teamwork Mode

Sessions default to `"solo"`. The `/teamwork` command activates teamwork mode — **one-way and irreversible** for the session lifetime.

**On `/teamwork` activation:**
1. Session record updated: `type = "teamwork"`
2. `systemPromptInjected = false` (reset so system prompt fires on next turn)
3. Reply in-thread: "Team mode activated. Agent will now see who is speaking."
4. Emit `plugin:workspace:teamworkActivated` hook
5. Push SSE event: `{ type: "workspace:teamworkActivated", sessionId }`

**Plugin behaviour is gated on session type:**
- `"solo"` → identity tracking still runs (records all messages), but no sender prefix, no mention processing, no system prompt injection. Session history is preserved and available if/when teamwork is later activated.
- `"teamwork"` → full feature set active: sender prefix, mention detection, system prompt, notifications

**`/teamwork` called on already-teamwork session:** no-op, reply "Already in team mode."

---

### Middleware Hooks

#### `message:incoming`
1. Construct `identityId = "{channelId}:{userId}"`
2. Lookup `users/{identityId}`; if not found: auto-create with `identityId`, `source`, `displayName = userId`
3. Write `meta.sender = { identityId, displayName, username }` into `TurnMeta`
4. Update presence: `lastSeen = now, status = "active"`
5. If session record has no `owner`: set `owner = identityId`, add to participants as `"owner"`
6. **Only if teamwork session:**
   - Parse `@username` in text → resolve via `usernames/` index → store resolved identityIds in `meta.mentions`
   - Add sender to participants list if not already present; emit `plugin:workspace:userJoined`

#### `agent:beforePrompt`
**Only if teamwork session:**
1. Read `meta.sender` — if missing: skip prefix, log warning, proceed
2. Prefix text: `[Lucas (@lucas)]: <original text>`
3. If `systemPromptInjected === false`: prepend system context, set flag = true:
   ```
   [System: Team session. Participants: {name} ({role}), ... Each message is
   prefixed with [Name]. You can @mention participants — they will be notified
   and can join to take action or make decisions.]
   ```
4. Persist message record using `meta.turnId` and `meta.sender.identityId`
5. Dispatch in-thread notifications for `meta.mentions` — user mentions fire immediately (before agent responds)

#### `agent:afterTurn` (new core hook — Change 1.3)
**Only if teamwork session:**
1. Parse `@username` in `fullText`
2. Resolve via `usernames/` index
3. For each resolved mention: send in-thread platform ping + push `workspace:mention` SSE event
4. Agent output mentions always fire AFTER the response is complete

#### `turn:start` / `turn:end`
- Update participant presence using `meta.sender` from `TurnMeta`
- `turn:end`: schedule idle status update after 30 min inactivity (setTimeout, outside hook)

#### `session:afterDestroy`
Plugin registers cleanup handler:
```typescript
const sessionStorage = ctx.storage.forSession(sessionId)
await sessionStorage.clear()
```

---

### Notification Strategy

**Timing:**
- User `@mention` → notify at `agent:beforePrompt` (immediately, before agent processes the turn)
- Agent `@mention` → notify at `agent:afterTurn` (after response is complete)

**Mechanism (v1):** `ctx.sendMessage(sessionId, message)` — sends in-thread, tags platform user. No adapter changes needed.

**SSE:** Plugin manages own connections on `GET /workspace/events`. Pushes structured events for App UI (badges, toasts, task updates).

---

### User Identity & Registration

#### API users (remote/App)
`identityId = "api:{token.sub}"` — stable across token refreshes.

```
PUT /workspace/users/me
Authorization: Bearer <token>
Body: { displayName: "Lucas", username: "lucas" }
→ Upserts users/api:{sub} + upserts usernames/{username} index

POST /workspace/users/me/link
Body: { platform: "telegram", platformUserId: "123456789" }
→ Adds "telegram:123456789" to linkedIdentities on both records
```

#### Adapter users (Telegram, Discord, Slack)
Auto-created on first `message:incoming`. Falls back to userId as displayName until enriched via `/whoami <name>`, which updates `displayName`, optionally sets `username`, and upserts the `usernames/` index.

---

### REST API

All routes registered via `apiServer.registerPlugin('/workspace', routes, { auth: true })`.

```
GET  /workspace/sessions/:sessionId/history       → messages with sender info
GET  /workspace/sessions/:sessionId/participants  → participant list + presence
GET  /workspace/sessions/:sessionId/tasks         → task list
PUT  /workspace/users/me                          → register/update own profile
POST /workspace/users/me/link                     → link platform account
GET  /workspace/users/:identityId                 → get user profile
GET  /workspace/events                            → SSE stream
```

---

### SSE Events

```typescript
{ type: "workspace:teamworkActivated", sessionId }
{ type: "workspace:mention",           sessionId, mentionedBy, mentionedUser, turnId }
{ type: "workspace:participant",       sessionId, identityId, action: "join" | "leave" }
{ type: "workspace:presence",          sessionId, identityId, status }
{ type: "workspace:task:assigned",     sessionId, taskId, assignee, title }
{ type: "workspace:task:done",         sessionId, taskId }
{ type: "workspace:handoff",           sessionId, from, to }
```

---

### Custom Plugin Hooks (emitted by workspace plugin)

Using core Change 1.5 — all auto-prefixed with `plugin:workspace:`:

```typescript
ctx.emitHook('teamworkActivated', { sessionId })
ctx.emitHook('userJoined',        { sessionId, identityId, role })
ctx.emitHook('userLeft',          { sessionId, identityId })
ctx.emitHook('taskAssigned',      { sessionId, taskId, assignee })
ctx.emitHook('handoff',           { sessionId, from, to })
ctx.emitHook('mention',           { sessionId, turnId, mentionedBy, mentionedUser })
```

Other plugins subscribe via full namespaced names:
`plugin:workspace:userJoined`, `plugin:workspace:mention`, etc.

---

### Chat Commands

| Command | Description |
|---|---|
| `/teamwork` | Activate teamwork mode (one-way, irreversible) |
| `/whoami <name>` | Set your display name |
| `/team` | List current participants and presence |
| `/assign @user <task>` | Assign a task (teamwork sessions only) |
| `/tasks` | List open tasks in this session |
| `/handoff @user` | Transfer session ownership (teamwork sessions only) |

---

### Error Handling

- User registry lookup failures: fall back to raw `userId` string, do not block message
- Mention resolution failure (unknown `@username`): skip notification silently, keep text unchanged
- Storage write failures: log error, do not block the prompt pipeline
- SSE push failures: log and continue — notifications are best-effort
- `meta.sender` missing at `agent:beforePrompt`: skip prefix, log warning, proceed with unmodified text
- `/teamwork` on already-teamwork session: no-op, reply "Already in team mode"

---

## Dependencies

- `api-server` plugin (optional — REST/SSE disabled if not available)
- OpenACP core ≥ version implementing Changes 1.1–1.7

---

## Out of Scope (v2+)

- Direct message notifications (requires adapter interface extension)
- Per-user permission scoping within a session
- Cross-session task tracking
- Agent-initiated handoff
- Typed event contracts for custom plugin hooks
