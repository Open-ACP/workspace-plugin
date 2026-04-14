import type { PluginContext } from '@openacp/plugin-sdk'
import type { IdentityService } from '../types.js'
import type { SessionStore } from '../session-store.js'
import { makeTeamworkCommand } from './teamwork.js'
import { makeTeamCommand } from './team.js'
import { makeAssignCommand } from './assign.js'
import { makeTasksCommand } from './tasks.js'
import { makePromoteCommand } from './promote.js'
import { makeWorkspaceStatusCommand } from './workspace-status.js'

export function registerCommands(
  ctx: PluginContext,
  identity: IdentityService,
  getSessionStore: (sid: string) => SessionStore,
  pluginVersion: string,
): void {
  ctx.registerCommand(makeWorkspaceStatusCommand(getSessionStore, pluginVersion))
  ctx.registerCommand(makeTeamworkCommand(getSessionStore, ctx, identity))
  // /whoami is owned by @openacp/identity (a required dependency) — no need to register here
  ctx.registerCommand(makeTeamCommand(getSessionStore, identity))
  ctx.registerCommand(makeAssignCommand(getSessionStore, identity, ctx))
  ctx.registerCommand(makeTasksCommand(getSessionStore, identity))
  ctx.registerCommand(makePromoteCommand(getSessionStore, identity, ctx))
}
