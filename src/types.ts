// All workspace plugin data types.
// Storage key conventions:
//   Session-scoped: session, messages/{turnId}

// ---------------------------------------------------------------------------
// Identity — minimal interface for core IdentityService consumption
// ---------------------------------------------------------------------------

/**
 * Subset of core IdentityService that workspace-plugin actually uses.
 * Defined locally to avoid compile-time dependency on the identity plugin.
 * Consumers get the real service via ctx.getService<IdentityService>('identity').
 */
export interface IdentityService {
  getUser(userId: string): Promise<IdentityUser | undefined>
  getUserByUsername(username: string): Promise<IdentityUser | undefined>
  getUserByIdentity(identityId: string): Promise<IdentityUser | undefined>
  updateUser(
    userId: string,
    changes: Partial<Pick<IdentityUser, 'displayName' | 'username'>>,
  ): Promise<IdentityUser>
}

/** Builds an IdentityId string from channelId + platform userId (same format as core). */
export function formatIdentityId(channelId: string, platformUserId: string): string {
  const source = (channelId === 'sse' || channelId === 'api') ? 'api' : channelId
  return `${source}:${platformUserId}`
}

/** Core UserRecord shape — only the fields workspace-plugin reads. */
export interface IdentityUser {
  userId: string
  displayName: string
  username?: string
  role: string
}

/**
 * Identity snapshot injected into TurnMeta by core's auto-register middleware.
 * Available as meta.identity in agent:beforePrompt, turn:start, etc.
 */
export interface IdentitySnapshot {
  userId: string
  identityId: string
  displayName: string
  username?: string
  role: string
}

/** Well-known TurnMeta key for resolved mentions (userId[]). */
export const TURN_META_MENTIONS_KEY = 'workspace.mentions'

// ---------------------------------------------------------------------------
// Session & Participants
// ---------------------------------------------------------------------------

export type ParticipantStatus = 'active' | 'idle' | 'offline'
export type ParticipantRole = 'owner' | 'member'

export interface ParticipantRecord {
  userId: string
  role: ParticipantRole
  joinedAt: string
  status: ParticipantStatus
  lastSeen: string
}

export interface TaskRecord {
  id: string
  title: string
  assignee?: string  // userId
  status: 'open' | 'done'
  createdAt: string
}

export interface SessionRecord {
  sessionId: string
  type: 'solo' | 'teamwork'
  owner: string  // userId
  participants: ParticipantRecord[]
  tasks: TaskRecord[]
  /** Whether the team system prompt has been injected for this session. */
  systemPromptInjected: boolean
  createdAt: string
}

export interface MessageRecord {
  turnId: string
  userId: string
  /** Original text before [Name]: prefix was added. */
  text: string
  mentions: string[]  // userId[]
  timestamp: string
}

// ---------------------------------------------------------------------------
// SSE Events
// ---------------------------------------------------------------------------

export type SseEvent =
  | { type: 'workspace:teamworkActivated'; sessionId: string }
  | { type: 'workspace:mention'; sessionId: string; mentionedBy: string; mentionedUser: string; turnId: string }
  | { type: 'workspace:participant'; sessionId: string; userId: string; action: 'join' | 'leave' }
  | { type: 'workspace:presence'; sessionId: string; userId: string; status: ParticipantStatus }
  | { type: 'workspace:task:assigned'; sessionId: string; taskId: string; assignee: string; title: string }
  | { type: 'workspace:task:done'; sessionId: string; taskId: string }
  | { type: 'workspace:promote'; sessionId: string; from: string; to: string }
