import type { IdentityService } from '../types.js'
import type { SessionStore } from '../session-store.js'
import type { MessageStore } from '../message-store.js'
import type { WorkspaceSseManager } from './sse.js'

/**
 * Mutable deps container — routes read from this on every request.
 * On hot-reload, setup() swaps the fields to point at fresh instances
 * while the Fastify routes (registered once) remain active.
 */
export interface RouteDeps {
  identity: IdentityService
  getSessionStore: (sid: string) => SessionStore
  getMessageStore: (sid: string) => MessageStore
  sse: WorkspaceSseManager
}

export async function workspaceRoutes(
  app: any,
  deps: RouteDeps,
): Promise<void> {
  // GET /workspace/sessions/:sessionId/history
  app.get('/sessions/:sessionId/history', async (req: any) => {
    const { sessionId } = req.params as { sessionId: string }
    const history = await deps.getMessageStore(sessionId).getHistory()
    const enriched = await Promise.all(history.map(async (m: any) => {
      const user = await deps.identity.getUser(m.userId)
      return { ...m, displayName: user?.displayName ?? m.userId, username: user?.username }
    }))
    return { history: enriched }
  })

  // GET /workspace/sessions/:sessionId/participants
  app.get('/sessions/:sessionId/participants', async (req: any) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = await deps.getSessionStore(sessionId).get()
    if (!session) return { participants: [] }
    const enriched = await Promise.all(session.participants.map(async (p: any) => {
      const user = await deps.identity.getUser(p.userId)
      return { ...p, displayName: user?.displayName, username: user?.username }
    }))
    return { participants: enriched, type: session.type, owner: session.owner }
  })

  // GET /workspace/sessions/:sessionId/tasks
  app.get('/sessions/:sessionId/tasks', async (req: any) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = await deps.getSessionStore(sessionId).get()
    return { tasks: session?.tasks ?? [] }
  })

  // GET /workspace/events — SSE stream
  app.get('/events', (req: any, reply: any) => {
    deps.sse.handleConnection(req, reply)
  })
}
