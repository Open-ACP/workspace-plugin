import type { CommandDef, PluginContext } from '@openacp/plugin-sdk'
import type { SessionStore } from '../session-store.js'
import type { IdentityService } from '../types.js'
import { formatIdentityId } from '../types.js'

export function makeTeamworkCommand(
  getSessionStore: (sid: string) => SessionStore,
  ctx: PluginContext,
  identity: IdentityService,
): CommandDef {
  return {
    name: 'teamwork',
    description: 'Activate team mode for this session (one-way, irreversible)',
    category: 'plugin',
    async handler(args) {
      if (!args.sessionId) return { type: 'error', message: 'Must be used in an active session.' }
      const store = getSessionStore(args.sessionId)
      let session = await store.get()

      // Init session if first interaction is /teamwork (no message sent yet)
      if (!session) {
        const identityId = formatIdentityId(args.channelId, args.userId)
        const user = await identity.getUserByIdentity(identityId)
        if (!user) return { type: 'error', message: 'Identity not found. Send a message first.' }
        session = await store.init(user.userId)
      }

      if (session.type === 'teamwork') return { type: 'text', text: 'Already in team mode.' }
      await store.activateTeamwork()
      await ctx.emitHook('teamworkActivated', { sessionId: args.sessionId })
      const fallback = [
        '✅ Team mode activated',
        '',
        'The agent now sees who is speaking and can @mention participants by name.',
        '',
        'Commands:',
        '/whoami @username [Display Name] — set your username and display name',
        '/team — list participants in this session',
        '/assign @user <task> — assign a task to a participant',
        '/tasks — view all assigned tasks',
        '/promote @user — transfer session ownership',
      ].join('\n')

      return {
        type: 'adaptive',
        fallback,
        variants: {
          telegram: {
            parse_mode: 'HTML',
            text: [
              '✅ <b>Team mode activated</b>',
              '',
              'The agent now sees who is speaking and can @mention participants by name.',
              '',
              '<b>Commands:</b>',
              '• <code>/whoami @username [Display Name]</code> — set your username and display name',
              '• <code>/team</code> — list participants in this session',
              '• <code>/assign @user &lt;task&gt;</code> — assign a task to a participant',
              '• <code>/tasks</code> — view all assigned tasks',
              '• <code>/promote @user</code> — transfer session ownership',
            ].join('\n'),
          },
          sse: {
            format: 'markdown',
            text: [
              '## ✅ Team mode activated',
              '',
              'The agent now sees who is speaking and can @mention participants by name.',
              '',
              '**Commands:**',
              '- `/whoami @username [Display Name]` — set your username and display name',
              '- `/team` — list participants in this session',
              '- `/assign @user <task>` — assign a task to a participant',
              '- `/tasks` — view all assigned tasks',
              '- `/promote @user` — transfer session ownership',
            ].join('\n'),
          },
        },
      }
    },
  }
}
