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

  async init(ownerIdentityId: string): Promise<SessionRecord> {
    const existing = await this.get()
    if (existing) return existing

    const now = new Date().toISOString()
    const record: SessionRecord = {
      sessionId: this.sessionId,
      type: 'solo',
      owner: ownerIdentityId,
      participants: [{
        identityId: ownerIdentityId,
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

  async addParticipant(identityId: string): Promise<boolean> {
    const s = await this.get()
    if (!s) return false
    if (s.participants.some(p => p.identityId === identityId)) return false
    const now = new Date().toISOString()
    const participant: ParticipantRecord = {
      identityId, role: 'member', joinedAt: now, status: 'active', lastSeen: now,
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

  async transferOwnership(newOwnerIdentityId: string): Promise<void> {
    const s = await this.get()
    if (!s) return
    const participants = s.participants.map(p => ({
      ...p,
      role: (p.identityId === newOwnerIdentityId ? 'owner'
        : p.identityId === s.owner ? 'member' : p.role) as 'owner' | 'member',
    }))
    await this.storage.set('session', { ...s, owner: newOwnerIdentityId, participants })
  }

  async updatePresence(identityId: string, status: ParticipantRecord['status']): Promise<void> {
    const s = await this.get()
    if (!s) return
    const now = new Date().toISOString()
    const participants = s.participants.map(p =>
      p.identityId === identityId ? { ...p, status, lastSeen: now } : p,
    )
    await this.storage.set('session', { ...s, participants })
  }
}
