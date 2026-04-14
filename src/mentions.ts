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

/**
 * Extracts a truncated text excerpt surrounding a @mention.
 *
 * Finds the first occurrence of @username, takes ~maxLen characters around it,
 * and trims to the nearest word boundary. Adds ellipsis where truncated.
 * Collapses whitespace and newlines to single spaces.
 */
export function extractMentionContext(
  text: string,
  username: string,
  maxLen: number = 150,
): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  const mentionPattern = `@${username}`
  const mentionIndex = collapsed.toLowerCase().indexOf(mentionPattern.toLowerCase())

  if (mentionIndex === -1) {
    if (collapsed.length <= maxLen) return collapsed
    const cut = collapsed.lastIndexOf(' ', maxLen)
    return collapsed.slice(0, cut > 0 ? cut : maxLen) + '…'
  }

  if (collapsed.length <= maxLen) return collapsed

  const mentionLen = mentionPattern.length
  const beforeBudget = Math.floor(maxLen / 3)
  const afterBudget = maxLen - beforeBudget

  let start = Math.max(0, mentionIndex - beforeBudget)
  let end = Math.min(collapsed.length, mentionIndex + mentionLen + afterBudget)

  // Snap start to the next word boundary so we don't cut mid-word
  if (start > 0) {
    const spaceAfterStart = collapsed.indexOf(' ', start)
    if (spaceAfterStart !== -1 && spaceAfterStart < mentionIndex) {
      start = spaceAfterStart + 1
    }
  }
  // Snap end to the previous word boundary so we don't cut mid-word
  if (end < collapsed.length) {
    const spaceBeforeEnd = collapsed.lastIndexOf(' ', end)
    if (spaceBeforeEnd > mentionIndex + mentionLen) {
      end = spaceBeforeEnd
    }
  }

  let result = collapsed.slice(start, end)
  if (start > 0) result = '…' + result
  if (end < collapsed.length) result = result + '…'

  return result
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
