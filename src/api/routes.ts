import type { UserRegistry } from '../identity.js'
import type { SessionStore } from '../session-store.js'
import type { MessageStore } from '../message-store.js'
import type { WorkspaceSseManager } from './sse.js'

/**
 * Mutable deps container — routes read from this on every request.
 * On hot-reload, setup() swaps the fields to point at fresh instances
 * while the Fastify routes (registered once) remain active.
 */
export interface RouteDeps {
  registry: UserRegistry
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
      const user = await deps.registry.getById(m.identityId)
      return { ...m, displayName: user?.displayName ?? m.identityId, username: user?.username }
    }))
    return { history: enriched }
  })

  // GET /workspace/sessions/:sessionId/participants
  app.get('/sessions/:sessionId/participants', async (req: any) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = await deps.getSessionStore(sessionId).get()
    if (!session) return { participants: [] }
    const enriched = await Promise.all(session.participants.map(async (p: any) => {
      const user = await deps.registry.getById(p.identityId)
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

  // PUT /workspace/users/me
  app.put('/users/me', async (req: any, reply: any) => {
    const user = (req as any).user as { sub: string } | undefined
    if (!user?.sub) return reply.status(401).send({ error: 'Unauthorized' })
    const { displayName, username } = req.body as { displayName?: string; username?: string }
    if (displayName !== undefined && (typeof displayName !== 'string' || !displayName.trim())) {
      return reply.status(400).send({ error: 'displayName must be a non-empty string' })
    }
    // Username must match the @mention pattern to be resolvable
    if (username !== undefined && (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(username))) {
      return reply.status(400).send({ error: 'username must contain only letters, numbers, _ . -' })
    }
    // Only include defined fields — avoids overwriting an existing name with undefined
    await deps.registry.upsert({
      identityId: `api:${user.sub}`,
      source: 'api',
      ...(displayName !== undefined && { displayName: displayName.trim() }),
      ...(username !== undefined && { username }),
    })
    return { ok: true }
  })

  // POST /workspace/users/me/link
  app.post('/users/me/link', async (req: any, reply: any) => {
    const user = (req as any).user as { sub: string } | undefined
    if (!user?.sub) return reply.status(401).send({ error: 'Unauthorized' })
    const { platform, platformUserId } = req.body as { platform: string; platformUserId: string }
    const apiId = `api:${user.sub}`
    const platformId = `${platform}:${platformUserId}`
    await deps.registry.linkIdentities(apiId, platformId)
    return { ok: true, linkedIdentityId: platformId }
  })

  // GET /workspace/users/:identityId
  app.get('/users/:identityId', async (req: any, reply: any) => {
    const { identityId } = req.params as { identityId: string }
    const user = await deps.registry.getById(decodeURIComponent(identityId))
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return { user }
  })

  // GET /workspace/events — SSE stream
  app.get('/events', (req: any, reply: any) => {
    deps.sse.handleConnection(req, reply)
  })
}
