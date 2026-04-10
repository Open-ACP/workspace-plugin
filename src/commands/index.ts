import type { PluginContext } from '@openacp/plugin-sdk'
import type { UserRegistry } from '../identity.js'
import type { SessionStore } from '../session-store.js'
import { makeTeamworkCommand } from './teamwork.js'
import { makeWhoamiCommand } from './whoami.js'
import { makeTeamCommand } from './team.js'
import { makeAssignCommand } from './assign.js'
import { makeTasksCommand } from './tasks.js'
import { makeHandoffCommand } from './handoff.js'

export function registerCommands(
  ctx: PluginContext,
  registry: UserRegistry,
  getSessionStore: (sid: string) => SessionStore,
): void {
  ctx.registerCommand(makeTeamworkCommand(getSessionStore, ctx))
  ctx.registerCommand(makeWhoamiCommand(registry))
  ctx.registerCommand(makeTeamCommand(getSessionStore, registry))
  ctx.registerCommand(makeAssignCommand(getSessionStore, registry))
  ctx.registerCommand(makeTasksCommand(getSessionStore, registry))
  ctx.registerCommand(makeHandoffCommand(getSessionStore, registry))
}
