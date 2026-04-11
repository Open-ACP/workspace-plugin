import type { OpenACPPlugin, PluginContext } from '@openacp/plugin-sdk'
import { UserRegistry } from './identity.js'
import { SessionStore } from './session-store.js'
import { MessageStore } from './message-store.js'
import { PresenceTracker } from './presence.js'
import { WorkspaceSseManager } from './api/sse.js'
import { workspaceRoutes } from './api/routes.js'
import { registerMessageIncoming } from './hooks/message-incoming.js'
import { registerAgentBeforePrompt } from './hooks/agent-before-prompt.js'
import { registerAgentAfterTurn } from './hooks/agent-after-turn.js'
import { registerTurnLifecycle } from './hooks/turn-lifecycle.js'
import { registerSessionDestroy } from './hooks/session-destroy.js'
import { registerCommands } from './commands/index.js'

const plugin: OpenACPPlugin = {
  name: '@openacp/workspace-plugin',
  version: '0.1.0',
  description: 'Multi-user collaboration for shared OpenACP sessions',

  permissions: [
    'events:read',
    'middleware:register',
    'commands:register',
    'storage:read',
    'storage:write',
    'services:use',
    'sessions:read',
  ],

  async setup(ctx: PluginContext): Promise<void> {
    // Core data modules
    const registry = new UserRegistry(ctx.storage)
    const presence = new PresenceTracker()
    const sse = new WorkspaceSseManager()

    const getSessionStore = (sessionId: string) =>
      new SessionStore(ctx.storage.forSession(sessionId), sessionId)
    const getMessageStore = (sessionId: string) =>
      new MessageStore(ctx.storage.forSession(sessionId))
    const getSessionStorage = (sessionId: string) =>
      ctx.storage.forSession(sessionId)
    const isTeamwork = async (sessionId: string) => {
      const s = await getSessionStore(sessionId).get()
      return s?.type === 'teamwork'
    }

    // Register middleware hooks
    registerMessageIncoming(ctx, registry, presence)
    registerAgentBeforePrompt(ctx, registry, getSessionStore, getMessageStore, presence)
    registerAgentAfterTurn(ctx, registry, isTeamwork)
    registerTurnLifecycle(ctx, getSessionStore, presence)
    registerSessionDestroy(ctx, getSessionStorage)

    // Declare custom hooks (other plugins can subscribe to these)
    ctx.defineHook('teamworkActivated')
    ctx.defineHook('userJoined')
    ctx.defineHook('userLeft')
    ctx.defineHook('taskAssigned')
    ctx.defineHook('handoff')
    ctx.defineHook('mention')

    // Register chat commands
    registerCommands(ctx, registry, getSessionStore)

    // Register REST/SSE routes via api-server service (optional dependency).
    // On hot-reload, Fastify has already booted so registerPlugin throws
    // AVV_ERR_ROOT_PLG_BOOTED — routes from the first load are still active.
    const apiServer = ctx.getService<{ registerPlugin(prefix: string, plugin: any, opts?: { auth?: boolean }): void }>('api-server')
    if (apiServer) {
      try {
        apiServer.registerPlugin('/workspace', async (app: any) => {
          await workspaceRoutes(app, { registry, getSessionStore, getMessageStore, sse })
        }, { auth: true })
        ctx.log.info('Workspace REST API registered at /workspace')
      } catch (err: any) {
        if (err?.code === 'AVV_ERR_ROOT_PLG_BOOTED') {
          ctx.log.debug('Skipping REST route registration — Fastify already booted (hot-reload)')
        } else {
          throw err
        }
      }
    } else {
      ctx.log.warn('api-server service not available — REST/SSE disabled')
    }

    // Wire SSE event push by observing plugin hooks via middleware on the full qualified name.
    // emitHook fires through the middleware chain (not EventBus), so we use registerMiddleware
    // with the fully-qualified hook name to observe without modifying the payload.
    const anyCtx = ctx as any
    anyCtx.registerMiddleware(`plugin:${plugin.name}:mention`, {
      handler: async (payload: any, next: any) => {
        sse.push({ type: 'workspace:mention', ...payload })
        return next()
      },
    })
    anyCtx.registerMiddleware(`plugin:${plugin.name}:teamworkActivated`, {
      handler: async (payload: any, next: any) => {
        sse.push({ type: 'workspace:teamworkActivated', ...payload })
        return next()
      },
    })
    anyCtx.registerMiddleware(`plugin:${plugin.name}:userJoined`, {
      handler: async (payload: any, next: any) => {
        sse.push({ type: 'workspace:participant', sessionId: payload.sessionId, identityId: payload.identityId, action: 'join' })
        return next()
      },
    })
    anyCtx.registerMiddleware(`plugin:${plugin.name}:handoff`, {
      handler: async (payload: any, next: any) => {
        sse.push({ type: 'workspace:handoff', ...payload })
        return next()
      },
    })

    ctx.log.info('@openacp/workspace-plugin ready')
  },

  async teardown(): Promise<void> {
    // PresenceTracker timers use unref() so they don't block process exit
  },

  async install(ctx): Promise<void> {
    ctx.terminal.log.success('@openacp/workspace-plugin installed.')
    ctx.terminal.log.info('Use /teamwork in a session to activate team collaboration mode.')
  },

  async uninstall(ctx, opts): Promise<void> {
    if (opts.purge) {
      await ctx.settings.clear()
      ctx.terminal.log.info('Plugin data purged.')
    }
    ctx.terminal.log.success('Uninstalled.')
  },
}

export default plugin
