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

/** Sender info written to TurnMeta by this plugin. */
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
