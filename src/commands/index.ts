import type { PluginContext } from '@openacp/plugin-sdk'
import type { IdentityService } from '../types.js'
import type { SessionStore } from '../session-store.js'
import { makeTeamworkCommand } from './teamwork.js'
import { makeWhoamiCommand } from './whoami.js'
import { makeTeamCommand } from './team.js'
import { makeAssignCommand } from './assign.js'
import { makeTasksCommand } from './tasks.js'
import { makePromoteCommand } from './promote.js'

export function registerCommands(
  ctx: PluginContext,
  identity: IdentityService,
  getSessionStore: (sid: string) => SessionStore,
): void {
  ctx.registerCommand(makeTeamworkCommand(getSessionStore, ctx, identity))
  ctx.registerCommand(makeWhoamiCommand(identity))
  ctx.registerCommand(makeTeamCommand(getSessionStore, identity))
  ctx.registerCommand(makeAssignCommand(getSessionStore, identity, ctx))
  ctx.registerCommand(makeTasksCommand(getSessionStore, identity))
  ctx.registerCommand(makePromoteCommand(getSessionStore, identity, ctx))
}
