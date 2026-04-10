import type { PluginContext, PluginStorage } from '@openacp/plugin-sdk'

export function registerSessionDestroy(
  ctx: PluginContext,
  getSessionStorage: (sessionId: string) => PluginStorage,
): void {
  ctx.registerMiddleware('session:afterDestroy', {
    handler: async (payload, next) => {
      const { sessionId } = payload as any
      try {
        await getSessionStorage(sessionId).clear()
      } catch {
        // Best-effort cleanup — don't block the destroy flow
      }
      return next()
    },
  })
}
