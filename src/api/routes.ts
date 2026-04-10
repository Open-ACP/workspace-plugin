import type { UserRegistry } from '../identity.js'
import type { SessionStore } from '../session-store.js'
import type { MessageStore } from '../message-store.js'
import type { WorkspaceSseManager } from './sse.js'

export async function workspaceRoutes(
  app: any,
  deps: {
    registry: UserRegistry
    getSessionStore: (sid: string) => SessionStore
    getMessageStore: (sid: string) => MessageStore
    sse: WorkspaceSseManager
  },
): Promise<void> {
  const { registry, getSessionStore, getMessageStore, sse } = deps

  // GET /workspace/sessions/:sessionId/history
  app.get('/sessions/:sessionId/history', async (req: any) => {
    const { sessionId } = req.params as { sessionId: string }
    const history = await getMessageStore(sessionId).getHistory()
    const enriched = await Promise.all(history.map(async (m: any) => {
      const user = await registry.getById(m.identityId)
      return { ...m, displayName: user?.displayName ?? m.identityId, username: user?.username }
    }))
    return { history: enriched }
  })

  // GET /workspace/sessions/:sessionId/participants
  app.get('/sessions/:sessionId/participants', async (req: any) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = await getSessionStore(sessionId).get()
    if (!session) return { participants: [] }
    const enriched = await Promise.all(session.participants.map(async (p: any) => {
      const user = await registry.getById(p.identityId)
      return { ...p, displayName: user?.displayName, username: user?.username }
    }))
    return { participants: enriched, type: session.type, owner: session.owner }
  })

  // GET /workspace/sessions/:sessionId/tasks
  app.get('/sessions/:sessionId/tasks', async (req: any) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = await getSessionStore(sessionId).get()
    return { tasks: session?.tasks ?? [] }
  })

  // PUT /workspace/users/me
  app.put('/users/me', async (req: any, reply: any) => {
    const user = (req as any).user as { sub: string } | undefined
    if (!user?.sub) return reply.status(401).send({ error: 'Unauthorized' })
    const { displayName, username } = req.body as { displayName?: string; username?: string }
    await registry.upsert({ identityId: `api:${user.sub}`, source: 'api', displayName, username })
    return { ok: true }
  })

  // POST /workspace/users/me/link
  app.post('/users/me/link', async (req: any, reply: any) => {
    const user = (req as any).user as { sub: string } | undefined
    if (!user?.sub) return reply.status(401).send({ error: 'Unauthorized' })
    const { platform, platformUserId } = req.body as { platform: string; platformUserId: string }
    const apiId = `api:${user.sub}`
    const platformId = `${platform}:${platformUserId}`
    await registry.linkIdentities(apiId, platformId)
    return { ok: true, linkedIdentityId: platformId }
  })

  // GET /workspace/users/:identityId
  app.get('/users/:identityId', async (req: any, reply: any) => {
    const { identityId } = req.params as { identityId: string }
    const user = await registry.getById(decodeURIComponent(identityId))
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return { user }
  })

  // GET /workspace/events — SSE stream
  app.get('/events', (req: any, reply: any) => {
    sse.handleConnection(req, reply)
  })
}
