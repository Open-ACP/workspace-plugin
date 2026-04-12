import type { OpenACPPlugin, PluginContext } from '@openacp/plugin-sdk'
import type { IdentityService } from './types.js'
import { SessionStore } from './session-store.js'
import { MessageStore } from './message-store.js'
import { PresenceTracker } from './presence.js'
import { WorkspaceSseManager } from './api/sse.js'
import { workspaceRoutes } from './api/routes.js'
import { registerAgentBeforePrompt } from './hooks/agent-before-prompt.js'
import { registerAgentAfterTurn } from './hooks/agent-after-turn.js'
import { registerTurnLifecycle } from './hooks/turn-lifecycle.js'
import { registerSessionDestroy } from './hooks/session-destroy.js'
import { registerCommands } from './commands/index.js'

const plugin: OpenACPPlugin = {
  name: '@openacp/workspace-plugin',
  version: '0.2.0',
  description: 'Multi-user collaboration for shared OpenACP sessions',

  pluginDependencies: {
    '@openacp/identity': '>=0.1.0',
  },

  permissions: [
    'events:read',
    'middleware:register',
    'commands:register',
    'storage:read',
    'storage:write',
    'services:use',
    'sessions:read',
    'kernel:access',
    // These permissions are defined in the identity-notifications worktree (not yet merged).
    // Cast as any until plugin-sdk is republished with the new permission types.
    'identity:read' as any,
    'identity:write' as any,
    'notifications:send' as any,
  ],

  async setup(ctx: PluginContext): Promise<void> {
    // Get core identity service (required dependency — must be available)
    const identity = ctx.getService<IdentityService>('identity')
    if (!identity) {
      throw new Error('@openacp/identity service not available — workspace-plugin requires it')
    }

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
    // Note: message:incoming is handled by core identity plugin (auto-registration at priority 110)
    registerAgentBeforePrompt(ctx, identity, getSessionStore, getMessageStore, presence)
    registerAgentAfterTurn(ctx, identity, isTeamwork)
    registerTurnLifecycle(ctx, getSessionStore, presence)
    registerSessionDestroy(ctx, getSessionStorage)

    // Declare custom hooks (other plugins can subscribe to these)
    ctx.defineHook('teamworkActivated')
    ctx.defineHook('userJoined')
    ctx.defineHook('userLeft')
    ctx.defineHook('taskAssigned')
    ctx.defineHook('promote')
    ctx.defineHook('mention')

    // Register chat commands
    registerCommands(ctx, identity, getSessionStore)

    // Register REST/SSE routes via api-server service (optional dependency).
    const apiServer = ctx.getService<{ registerPlugin(prefix: string, plugin: any, opts?: { auth?: boolean }): void }>('api-server')
    if (apiServer) {
      apiServer.registerPlugin('/workspace', async (app: any) => {
        await workspaceRoutes(app, { identity, getSessionStore, getMessageStore, sse })
      }, { auth: true })
      ctx.log.info('Workspace REST API registered at /workspace')
    } else {
      ctx.log.warn('api-server service not available — REST/SSE disabled')
    }

    // Wire SSE event push by observing plugin hooks via middleware.
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
        sse.push({ type: 'workspace:participant', sessionId: payload.sessionId, userId: payload.userId, action: 'join' })
        return next()
      },
    })
    anyCtx.registerMiddleware(`plugin:${plugin.name}:promote`, {
      handler: async (payload: any, next: any) => {
        sse.push({ type: 'workspace:promote', ...payload })
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
