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

  async init(ownerUserId: string): Promise<SessionRecord> {
    const existing = await this.get()
    if (existing) return existing

    const now = new Date().toISOString()
    const record: SessionRecord = {
      sessionId: this.sessionId,
      type: 'solo',
      owner: ownerUserId,
      participants: [{
        userId: ownerUserId,
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
      systemPromptInjected: false,
    })
  }

  async addParticipant(userId: string): Promise<boolean> {
    const s = await this.get()
    if (!s) return false
    if (s.participants.some(p => p.userId === userId)) return false
    const now = new Date().toISOString()
    const participant: ParticipantRecord = {
      userId, role: 'member', joinedAt: now, status: 'active', lastSeen: now,
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

  async transferOwnership(newOwnerUserId: string): Promise<void> {
    const s = await this.get()
    if (!s) return
    const participants = s.participants.map(p => ({
      ...p,
      role: (p.userId === newOwnerUserId ? 'owner'
        : p.userId === s.owner ? 'member' : p.role) as 'owner' | 'member',
    }))
    await this.storage.set('session', { ...s, owner: newOwnerUserId, participants })
  }

  async updatePresence(userId: string, status: ParticipantRecord['status']): Promise<void> {
    const s = await this.get()
    if (!s) return
    const now = new Date().toISOString()
    const participants = s.participants.map(p =>
      p.userId === userId ? { ...p, status, lastSeen: now } : p,
    )
    await this.storage.set('session', { ...s, participants })
  }
}
