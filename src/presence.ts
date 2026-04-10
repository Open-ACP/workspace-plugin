import type { SessionStore } from './session-store.js'

// Idle timeout: mark a participant as idle after 30 minutes of inactivity.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000

export class PresenceTracker {
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

  markActive(sessionStore: SessionStore, sessionId: string, identityId: string): void {
    const key = `${sessionId}:${identityId}`
    const existing = this.idleTimers.get(key)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(async () => {
      await sessionStore.updatePresence(identityId, 'idle')
      this.idleTimers.delete(key)
    }, IDLE_TIMEOUT_MS)
    // Allow process to exit even if timer is pending
    timer.unref?.()
    this.idleTimers.set(key, timer)
  }

  clearAll(): void {
    for (const timer of this.idleTimers.values()) clearTimeout(timer)
    this.idleTimers.clear()
  }
}
