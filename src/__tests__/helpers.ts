import type { IdentityService, IdentityUser } from '../types.js'

/**
 * In-memory mock of core IdentityService for tests.
 * Stores users by userId and provides lookup by username and identityId.
 */
export function createMockIdentityService(): IdentityService & {
  /** Seed a user for test setup */
  addUser(user: IdentityUser & { identityId?: string }): void
  users: Map<string, IdentityUser & { identityId?: string }>
} {
  const users = new Map<string, IdentityUser & { identityId?: string }>()
  // Secondary index: identityId → userId
  const identityIndex = new Map<string, string>()
  // Secondary index: username → userId
  const usernameIndex = new Map<string, string>()

  function addUser(user: IdentityUser & { identityId?: string }) {
    users.set(user.userId, user)
    if (user.identityId) identityIndex.set(user.identityId, user.userId)
    if (user.username) usernameIndex.set(user.username.toLowerCase(), user.userId)
  }

  return {
    users,
    addUser,

    async getUser(userId: string) {
      return users.get(userId)
    },

    async getUserByUsername(username: string) {
      const uid = usernameIndex.get(username.toLowerCase())
      return uid ? users.get(uid) : undefined
    },

    async getUserByIdentity(identityId: string) {
      const uid = identityIndex.get(identityId)
      return uid ? users.get(uid) : undefined
    },

    async updateUser(userId: string, changes: Partial<Pick<IdentityUser, 'displayName' | 'username'>>) {
      const existing = users.get(userId)
      if (!existing) throw new Error(`User ${userId} not found`)
      // Update username index
      if (changes.username && existing.username !== changes.username) {
        if (existing.username) usernameIndex.delete(existing.username.toLowerCase())
        usernameIndex.set(changes.username.toLowerCase(), userId)
      }
      const updated = { ...existing, ...changes }
      users.set(userId, updated)
      return updated
    },
  }
}
