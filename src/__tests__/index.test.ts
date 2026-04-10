import { describe, it, expect } from 'vitest'
import { createTestContext, createTestInstallContext } from '@openacp/plugin-sdk/testing'
import plugin from '../index.js'

describe('@openacp/workspace-plugin', () => {
  it('has correct metadata', () => {
    expect(plugin.name).toBe('@openacp/workspace-plugin')
    expect(plugin.version).toBeDefined()
    expect(plugin.setup).toBeInstanceOf(Function)
  })

  it('sets up without errors', async () => {
    const ctx = createTestContext({
      pluginName: '@openacp/workspace-plugin',
      pluginConfig: { enabled: true },
      permissions: plugin.permissions,
    })
    await expect(plugin.setup(ctx)).resolves.not.toThrow()
  })

  it('tears down without errors', async () => {
    if (plugin.teardown) {
      await expect(plugin.teardown()).resolves.not.toThrow()
    }
  })

  it('installs without errors', async () => {
    if (plugin.install) {
      const ctx = createTestInstallContext({
        pluginName: '@openacp/workspace-plugin',
        terminalResponses: { password: [''], confirm: [true], select: ['apiKey'] },
      })
      await expect(plugin.install(ctx)).resolves.not.toThrow()
    }
  })
})
