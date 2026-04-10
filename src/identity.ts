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
   * is removed and the new one is added.
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
