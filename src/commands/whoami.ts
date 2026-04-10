import type { CommandDef } from '@openacp/plugin-sdk'
import type { UserRegistry } from '../identity.js'
import { UserRegistry as UR } from '../identity.js'
import type { IdentitySource } from '../types.js'

export function makeWhoamiCommand(registry: UserRegistry): CommandDef {
  return {
    name: 'whoami',
    description: 'Set your display name',
    usage: '<name>',
    category: 'plugin',
    async handler(args) {
      const name = args.raw.trim()
      if (!name) return { type: 'error', message: 'Usage: /whoami <your name>' }
      const source = (args.channelId === 'sse' || args.channelId === 'api') ? 'api' : args.channelId as IdentitySource
      const identityId = UR.buildIdentityId(source, args.userId)
      await registry.upsert({ identityId, source, displayName: name })
      return { type: 'text', text: `✅ Your display name is now "${name}".` }
    },
  }
}
