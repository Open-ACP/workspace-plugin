import type { SseEvent } from '../types.js'
import type * as http from 'node:http'

/**
 * Manages SSE connections for workspace real-time events.
 * Clients connect to GET /workspace/events.
 */
export class WorkspaceSseManager {
  private connections = new Set<http.ServerResponse>()

  handleConnection(req: any, reply: any): void {
    const res = reply.raw as http.ServerResponse
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    // Disable proxy buffering so events reach the client immediately
    res.setHeader('X-Accel-Buffering', 'no')
    res.writeHead(200)
    // Initial comment keeps the connection alive and signals readiness
    res.write(':\n\n')
    this.connections.add(res)
    req.raw.on('close', () => this.connections.delete(res))
  }

  push(event: SseEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const conn of this.connections) {
      try { conn.write(data) } catch { this.connections.delete(conn) }
    }
  }

  get connectionCount(): number {
    return this.connections.size
  }
}
