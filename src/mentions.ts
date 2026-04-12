import type { IdentityService } from './types.js'

const MENTION_REGEX = /@([a-zA-Z0-9_.-]+)/g

/** Extracts all unique @mention usernames from text. Returns usernames without '@'. */
export function extractMentions(text: string): string[] {
  const matches = new Set<string>()
  for (const match of text.matchAll(MENTION_REGEX)) {
    if (match[1]) matches.add(match[1].toLowerCase())
  }
  return [...matches]
}

/** Resolves mention usernames to userIds via IdentityService. Unknown usernames are silently skipped. */
export async function resolveMentions(
  usernames: string[],
  identity: IdentityService,
): Promise<string[]> {
  const results = await Promise.all(
    usernames.map(async u => {
      const user = await identity.getUserByUsername(u)
      return user?.userId
    }),
  )
  return results.filter((id): id is string => id !== undefined)
}
