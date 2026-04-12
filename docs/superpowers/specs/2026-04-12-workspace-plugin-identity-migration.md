# Workspace Plugin — Migration to Core Identity & Notifications

**Date:** 2026-04-12
**Status:** Draft
**Depends on:**
- [Core Identity System](../../../OpenACP/docs/superpowers/specs/2026-04-12-core-identity-system-design.md)
- [Core Push Notification System](../../../OpenACP/docs/superpowers/specs/2026-04-12-core-push-notification-design.md)

---

## Overview

Workspace-plugin currently implements its own identity system (`UserRegistry`, `UserRecord`) backed by plugin-scoped storage. The new core `@openacp/identity` plugin provides a unified identity service. This spec describes how workspace-plugin migrates from self-managed identity to consuming `IdentityService` from core, and from no-op `ctx.sendMessage()` to `ctx.notify()` for mention notifications.

No data migration is needed — existing workspace plugin data can be discarded (test-phase decision).

---

## Changes Summary

### Removed

| File | Reason |
|---|---|
| `identity.ts` | Replaced by core `IdentityService` via `ctx.getService('identity')` |
| `hooks/message-incoming.ts` | Core identity plugin auto-registers users at priority 110 and injects `meta.identity` |

### Modified

| File | Changes |
|---|---|
| `types.ts` | Remove `UserRecord`, `IdentitySource`, `TURN_META_SENDER_KEY`, `TURN_META_CHANNEL_USER_KEY`, `ChannelUserMeta`. Add `IdentitySnapshot` type. Change `ParticipantRecord.identityId` → `.userId`. Change `SessionRecord.owner` to use `userId`. Change `MessageRecord.identityId` → `.userId` |
| `mentions.ts` | Replace `UserRegistry` dependency with `IdentityService`. `resolveMentions()` returns `userId[]` instead of `identityId[]` |
| `hooks/agent-before-prompt.ts` | Read `meta.identity` instead of `meta[TURN_META_SENDER_KEY]`. Use `userId` for participant tracking. Use `ctx.notify()` for mention notifications |
| `hooks/agent-after-turn.ts` | Replace `UserRegistry` with `IdentityService`. Use `ctx.notify()` instead of `ctx.sendMessage()` |
| `hooks/turn-lifecycle.ts` | Read `meta.identity.userId` instead of `meta[TURN_META_SENDER_KEY].identityId` |
| `commands/whoami.ts` | Use `identityService.updateUser()` instead of `registry.upsert()` |
| `commands/teamwork.ts` | Replace `UserRegistry` with `IdentityService` |
| `commands/team.ts` | Replace `UserRegistry` with `IdentityService` |
| `commands/assign.ts` | Replace `UserRegistry` with `IdentityService` |
| `commands/tasks.ts` | Replace `UserRegistry` with `IdentityService` |
| `commands/promote.ts` | Replace `UserRegistry` with `IdentityService` |
| `commands/index.ts` | Pass `IdentityService` instead of `UserRegistry` |
| `api/routes.ts` | Replace `RouteDeps.registry` with `IdentityService` |
| `index.ts` | Remove `UserRegistry` creation. Get `IdentityService` from service registry. Add new permissions. Remove `message-incoming` registration |
| `presence.ts` | No changes (session-scoped, identity-independent) |
| `session-store.ts` | No interface changes (keys are strings; callers pass `userId` instead of `identityId`) |
| `message-store.ts` | No interface changes (same reason) |

### Unchanged

| File | Reason |
|---|---|
| `presence.ts` | Operates on session-scoped timers, no identity dependency |
| `session-store.ts` | Generic string keys; callers change what they pass |
| `message-store.ts` | Same as above |
| `hooks/session-destroy.ts` | No identity dependency |
| `api/sse.ts` | No identity dependency |

---

## Part 1 — Identity Snapshot in TurnMeta

Core identity plugin injects `meta.identity` on every incoming message:

```typescript
interface IdentitySnapshot {
  userId: string        // 'u_abc123' — stable cross-platform key
  identityId: string    // 'telegram:123' — platform-specific
  displayName: string
  username?: string
  role: string          // 'admin' | 'member' | 'viewer' | 'blocked'
}
```

Workspace-plugin reads this instead of managing its own `TURN_META_SENDER_KEY`.

---

## Part 2 — Key Type Migration

All internal keys change from `identityId` (platform-specific, e.g. `telegram:123`) to `userId` (stable cross-platform, e.g. `u_abc123`).

```typescript
// Before
interface ParticipantRecord {
  identityId: string
  role: ParticipantRole
  // ...
}

// After
interface ParticipantRecord {
  userId: string
  role: ParticipantRole
  // ...
}
```

Same for `SessionRecord.owner` and `MessageRecord`.

---

## Part 3 — IdentityService Usage

### Lookup patterns

```typescript
const identity = ctx.getService<IdentityService>('identity')

// By username (@mention resolution)
const user = await identity.getUserByUsername('lucas')

// By userId (participant enrichment)
const user = await identity.getUser(participant.userId)

// Update profile (/whoami)
await identity.updateUser(userId, { username, displayName })
```

### Permission requirement

Plugin declares `identity:read` in permissions. Write operations (`/whoami` → `updateUser()`) go through `identity:write` or the identity plugin's own `/whoami` command.

Decision: workspace-plugin keeps its own `/whoami` command and calls `identityService.updateUser()` — this requires adding `identity:write` permission, OR workspace-plugin delegates to identity plugin's built-in `/whoami`. **Recommendation**: keep workspace `/whoami` (it has workspace-specific validation like requiring username for teamwork) and add `identity:write`.

---

## Part 4 — Notifications

### Mention notifications (user → user)

```typescript
// agent-before-prompt.ts — when user @mentions another user
ctx.notify(
  { userId: mentionedUserId },
  { type: 'text', text: `${sender.displayName} mentioned you in session` },
  { via: 'dm' }
)
```

### Agent mention notifications (agent → user)

```typescript
// agent-after-turn.ts — when agent @mentions a user in its response
ctx.notify(
  { userId: mentionedUserId },
  { type: 'text', text: `The agent mentioned @${username}. Your input may be needed.` },
  { via: 'dm' }
)
```

### Blocked turn error (no username in teamwork)

Keep the current `eventBus.emit('agent:event', ...)` pattern — this is not a notification to another user, it's an error response to the current user in the current session. `ctx.notify()` would not clear the streaming state.

---

## Part 5 — Plugin Manifest Changes

```typescript
const plugin: OpenACPPlugin = {
  name: '@openacp/workspace-plugin',
  version: '0.2.0',

  pluginDependencies: {
    '@openacp/identity': '>=0.1.0',
  },

  permissions: [
    'events:read',
    'middleware:register',
    'commands:register',
    'storage:read', 'storage:write',
    'services:use',
    'sessions:read',
    'kernel:access',
    'identity:read',          // NEW — lookup users
    'identity:write',         // NEW — /whoami updateUser
    'notifications:send',     // NEW — ctx.notify()
  ],
}
```

---

## Part 6 — Boot Order

1. Security plugin (priority 100) — blocks unauthorized users
2. Identity plugin (auto-register at priority 110) — creates user records, injects `meta.identity`
3. Workspace plugin (hooks at priority 20) — reads `meta.identity`, manages sessions

No conflict: workspace hooks run at priority 20 on `agent:beforePrompt`, but `meta.identity` was already injected by `message:incoming` (different hook, runs before `agent:beforePrompt`).

---

## Error Handling

- `ctx.getService('identity')` returns `undefined` if identity plugin not loaded → plugin should fail fast in `setup()` since it declares `pluginDependencies`
- `ctx.notify()` is fire-and-forget — delivery failures are silently logged by core
- `identity.getUserByUsername()` returns `undefined` for unknown usernames → existing error paths handle this
