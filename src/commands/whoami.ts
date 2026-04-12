import type { CommandDef } from '@openacp/plugin-sdk'
import type { IdentityService } from '../types.js'
import { formatIdentityId } from '../types.js'

export function makeWhoamiCommand(identity: IdentityService): CommandDef {
  return {
    name: 'whoami',
    description: 'Set your username and display name',
    usage: '@username [Display Name]',
    category: 'plugin',
    async handler(args) {
      const raw = args.raw.trim()
      if (!raw) return { type: 'error', message: 'Usage: /whoami @username [Display Name]' }

      const tokens = raw.split(/\s+/)
      const first = tokens[0]

      // First token must be a username (with or without leading @)
      const usernameRaw = first.startsWith('@') ? first.slice(1) : first
      if (!/^[a-zA-Z0-9_.-]+$/.test(usernameRaw)) {
        return { type: 'error', message: 'Invalid username. Only letters, numbers, _ . - allowed.' }
      }

      const username = usernameRaw
      const displayName = tokens.slice(1).join(' ') || undefined

      // Resolve caller's userId via core identity service
      const identityId = formatIdentityId(args.channelId, args.userId)
      const user = await identity.getUserByIdentity(identityId)
      if (!user) return { type: 'error', message: 'Identity not found. Send a message first.' }

      await identity.updateUser(user.userId, { username, ...(displayName && { displayName }) })

      const parts = [`@${username}`]
      if (displayName) parts.push(`"${displayName}"`)
      return { type: 'text', text: `✅ Profile updated: ${parts.join(' ')}` }
    },
  }
}
