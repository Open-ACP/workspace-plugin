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
