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

/**
 * Channel user info injected into TurnMeta by the channel adapter via handleMessage(initialMeta).
 * Any adapter can populate this so plugins can identify who sent the message without
 * needing adapter-specific fields on IncomingMessage.
 */
export interface ChannelUserMeta {
  /** The channel adapter this message came from (telegram, discord, slack, api, sse). */
  channelId: string
  /** Raw user ID as provided by the channel. */
  userId: string
  /** Human-readable display name (e.g. Telegram first+last name, Discord display name). */
  displayName?: string
  /** Channel handle without prefix (e.g. Telegram @handle, Discord username#tag). */
  username?: string
  /** Extra adapter-specific fields for forward compatibility. */
  [key: string]: unknown
}

/** Sender info written to TurnMeta by this plugin after resolving against the registry. */
export interface WorkspaceTurnSender {
  identityId: string
  displayName: string
  username?: string
}

/** Well-known TurnMeta key for channel adapter user info (set by adapters, read by plugins). */
export const TURN_META_CHANNEL_USER_KEY = 'channelUser'
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
