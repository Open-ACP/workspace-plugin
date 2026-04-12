# @openacp/workspace-plugin

Multi-user collaboration plugin for [OpenACP](https://github.com/Open-ACP/OpenACP). Turn any AI session into a shared workspace where multiple people can talk to the same agent, assign tasks, and coordinate work — across Telegram, Discord, Slack, and the OpenACP App.

## What It Does

By default, OpenACP sessions are single-user: one person talks to one AI agent. This plugin adds **team mode** — a collaborative layer where:

- **Multiple users share one agent session** — everyone sees who said what
- **The agent knows who's talking** — messages are prefixed with `[Name (@handle)]:`
- **@mentions work** — mention a teammate and they get notified, even on a different platform
- **Tasks can be assigned** — create and track work items within the session
- **Presence is tracked** — see who's active, idle, or offline

### How It Looks

```
[Alice (@alice)]: Can you refactor the auth module?
[Agent]: I'll start with the middleware. @bob I'll need you to review the database schema.

📢 Bob was mentioned by the agent.

[Bob (@bob)]: Sure, I'll check the schema now.
```

## Quick Start

### 1. Install the plugin

```bash
openacp plugin add @openacp/workspace-plugin
```

### 2. Activate team mode in any session

Type `/teamwork` in a session topic (Telegram, Discord, Slack, or the App). This is a one-way activation — the session permanently becomes a team workspace.

### 3. Set your identity

```
/whoami @alice Alice Nguyen
```

This sets your `@handle` (used for mentions) and display name. Required before you can send messages in team mode.

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/teamwork` | Activate team mode for the current session | `/teamwork` |
| `/whoami` | Set your username and display name | `/whoami @alice Alice Nguyen` |
| `/team` | List all participants and their status | `/team` |
| `/assign` | Assign a task to a participant | `/assign @bob Fix the login bug` |
| `/tasks` | List all open tasks | `/tasks` |
| `/promote` | Transfer session ownership to another user | `/promote @bob` |

## Features

### Team Mode (`/teamwork`)

Activating team mode changes how the session works:

- Every message is prefixed with the sender's name so the agent can distinguish speakers
- A system prompt is injected telling the agent about all participants and their roles
- @mentions in both user messages and agent responses are detected and routed

Team mode is **irreversible** — once activated, the session stays collaborative.

### Identity (`/whoami`)

```
/whoami @handle [Display Name]
```

- The `@handle` is **required** — it's how others mention you
- The display name is optional (defaults to your platform name)
- Usernames must be unique and can contain letters, numbers, `_`, `.`, `-`
- Identity is managed by the core `@openacp/identity` plugin and works across all platforms

**Cross-platform identity**: If your Telegram and App accounts are linked (via the identity system), teammates can @mention you and you'll be notified on whichever platform you're using.

### @Mentions & Notifications

When someone types `@alice` in a message:
1. The plugin resolves `alice` to a user via the identity service
2. The mentioned user receives a notification (DM, push, or in-app — depending on their platform)
3. The mention is recorded for the session history

The agent can also @mention participants in its responses. When it does, the mentioned user gets notified with a prompt to check the session.

### Task Management (`/assign`, `/tasks`)

Lightweight task tracking built into the session:

```
/assign @bob Review the PR for auth refactor
✅ Task assigned to Bob: "Review the PR for auth refactor" (t_abc123)

/tasks
**Open tasks:**
• [t_abc123] Review the PR for auth refactor → Bob
```

Tasks are stored per-session and visible to all participants.

### Presence Tracking

The plugin tracks whether each participant is active, idle, or offline:

- **Active** (🟢) — sent a message recently
- **Idle** (🟡) — no activity for 30 minutes
- **Offline** (⚫) — disconnected or left

View presence with `/team`:

```
🟢 Alice (owner)
🟢 Bob (member)
🟡 Charlie (member)
```

### Ownership & Roles

- The user who activates `/teamwork` becomes the **owner**
- All other participants are **members**
- Only the owner can transfer ownership via `/promote @user`
- Ownership affects who can manage the session (e.g., transfer control)

## Architecture

### How It Works

```
User message → [Core Identity Plugin] → meta.identity injected
                                            ↓
              [Workspace Plugin: agent:beforePrompt]
                ├── Initialize session record (first message)
                ├── Persist message to history
                ├── Track presence (mark active)
                ├── Add participant if new
                ├── [Teamwork] Require username
                ├── [Teamwork] Prefix text: [Name (@handle)]: ...
                ├── [Teamwork] Inject system prompt (first turn)
                └── [Teamwork] Resolve @mentions → notify users
                                            ↓
                            Agent processes prompt
                                            ↓
              [Workspace Plugin: agent:afterTurn]
                └── Detect @mentions in agent response → notify users
```

### Dependencies

| Dependency | Required | Purpose |
|------------|----------|---------|
| `@openacp/identity` | Yes | User lookup, username resolution, profile updates |
| `@openacp/api-server` | No | REST API + SSE endpoints (disabled if not available) |

### Middleware Hooks

| Hook | Priority | Purpose |
|------|----------|---------|
| `agent:beforePrompt` | 20 | Session init, message persistence, teamwork logic |
| `agent:afterTurn` | default | Detect agent @mentions, send notifications |
| `turn:start` | default | Update participant presence |
| `session:afterDestroy` | default | Clean up session storage |

### Custom Hooks

Other plugins can subscribe to workspace events via middleware:

| Hook | Payload | When |
|------|---------|------|
| `teamworkActivated` | `{ sessionId }` | Team mode turned on |
| `userJoined` | `{ sessionId, userId, role }` | New participant joins |
| `taskAssigned` | `{ sessionId, taskId, assignee, title }` | Task assigned |
| `promote` | `{ sessionId, from, to }` | Ownership transferred |
| `mention` | `{ sessionId, turnId, mentionedBy, mentionedUser }` | User @mentioned |

### REST API

When `@openacp/api-server` is available, the plugin registers routes under `/api/v1/workspace`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions/:id/history` | Message history with user details |
| `GET` | `/sessions/:id/participants` | Participant list with presence |
| `GET` | `/sessions/:id/tasks` | Open tasks |
| `GET` | `/events` | SSE stream for real-time workspace events |

### Storage

All session data is stored via OpenACP's plugin storage system (scoped per session):

- `session` — Session record (type, owner, participants, tasks)
- `messages/{turnId}` — Individual message records

## Permissions

```
events:read          — Subscribe to system events
middleware:register  — Register hooks on message/agent lifecycle
commands:register    — Register /teamwork, /whoami, etc.
storage:read/write   — Persist session and message data
services:use         — Access identity + api-server services
sessions:read        — Query session info
kernel:access        — Access EventBus for streaming state signals
identity:read        — Look up users by ID/username
identity:write       — Update user profiles (/whoami)
notifications:send   — Send @mention notifications
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests (52 tests)
npm test

# Watch mode
npm run dev

# Live development with hot-reload
openacp dev .
```

### Project Structure

```
src/
  index.ts                    — Plugin entry point
  types.ts                    — Data types, IdentityService interface
  session-store.ts            — Session state management (per-session)
  message-store.ts            — Message history persistence
  presence.ts                 — Idle timeout tracking
  mentions.ts                 — @mention parsing and resolution
  hooks/
    agent-before-prompt.ts    — Main teamwork logic (prefix, system prompt, mentions)
    agent-after-turn.ts       — Detect agent @mentions in responses
    turn-lifecycle.ts         — Presence updates on turn start
    session-destroy.ts        — Storage cleanup on session end
  commands/
    index.ts                  — Command registration hub
    teamwork.ts               — /teamwork command
    whoami.ts                 — /whoami command
    team.ts                   — /team command
    assign.ts                 — /assign command
    tasks.ts                  — /tasks command
    promote.ts                — /promote command
  api/
    routes.ts                 — REST API route definitions
    sse.ts                    — SSE event broadcasting
  __tests__/
    helpers.ts                — Mock IdentityService for tests
    *.test.ts                 — Test suites (52 tests total)
```

## License

MIT
