import type { CommandDef } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'

/**
 * /workspace — shows plugin load status and current session state.
 * Useful for verifying the plugin is running and debugging session data.
 */
export function makeWorkspaceStatusCommand(
  getSessionStore: (sid: string) => SessionStore,
  pluginVersion: string,
): CommandDef {
  return {
    name: 'workspace',
    description: 'Show workspace plugin status and current session state',
    category: 'plugin',
    async handler(args) {
      const lines: string[] = [
        `✅ @openacp/workspace-plugin v${pluginVersion} is running`,
        '',
        'Commands: /teamwork, /team, /assign, /tasks, /promote',
      ]

      if (!args.sessionId) {
        lines.push('', 'No active session.')
        return { type: 'text', text: lines.join('\n') }
      }

      try {
        const session = await getSessionStore(args.sessionId).get()
        if (!session) {
          lines.push('', `Session: ${args.sessionId}`, 'No workspace data yet — send a message or run /teamwork to initialize.')
        } else {
          lines.push(
            '',
            `Session: ${args.sessionId}`,
            `Mode: ${session.type}`,
            `Owner: ${session.owner}`,
            `Participants: ${session.participants.length}`,
            `Open tasks: ${session.tasks.filter(t => t.status === 'open').length}`,
            `System prompt injected: ${session.systemPromptInjected}`,
          )
        }
      } catch (err) {
        lines.push('', `Session read error: ${err instanceof Error ? err.message : String(err)}`)
      }

      return { type: 'text', text: lines.join('\n') }
    },
  }
}
