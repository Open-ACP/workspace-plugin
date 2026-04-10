import type { UserRegistry } from './identity.js'

const MENTION_REGEX = /@([a-zA-Z0-9_.-]+)/g

/** Extracts all unique @mention usernames from text. Returns usernames without '@'. */
export function extractMentions(text: string): string[] {
  const matches = new Set<string>()
  for (const match of text.matchAll(MENTION_REGEX)) {
    if (match[1]) matches.add(match[1].toLowerCase())
  }
  return [...matches]
}

/** Resolves mention usernames to identityIds. Unknown usernames are silently skipped. */
export async function resolveMentions(
  usernames: string[],
  registry: UserRegistry,
): Promise<string[]> {
  const results = await Promise.all(
    usernames.map(u => registry.resolveUsername(u)),
  )
  return results.filter((id): id is string => id !== undefined)
}
