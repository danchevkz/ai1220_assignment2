import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence } from 'y-indexeddb'

// Connection states exposed to the UI.
// - offline: WS has never connected yet
// - connecting: handshake in progress
// - connected: WS open, sync step 2 completed (fully in sync with server)
// - disconnected: WS was connected but dropped; provider will retry
export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'disconnected'

export interface YjsProviderOptions {
  documentId: string
  // WebSocket base URL (e.g. ws://localhost:8000/ws). The document id is appended.
  wsUrl: string
  // JWT access token — appended as ?token= so the server can auth the upgrade.
  token: string
  // Disable IndexedDB persistence (useful for tests).
  persist?: boolean
}

export interface YjsListener {
  onStatusChange?: (status: ConnectionStatus) => void
  onSynced?: () => void
}

// Thin wrapper around Y.Doc + y-websocket + y-indexeddb.
// Owns the lifecycle of all three and exposes a minimal, testable surface.
export class YjsProvider {
  readonly doc: Y.Doc
  readonly wsProvider: WebsocketProvider
  readonly persistence: IndexeddbPersistence | null

  private listeners: YjsListener[] = []
  private status: ConnectionStatus = 'offline'
  private synced = false
  private destroyed = false

  constructor(opts: YjsProviderOptions) {
    this.doc = new Y.Doc()

    // IndexedDB persistence — gives us offline editing for free.
    // The Y.Doc is hydrated from IDB before the WS even connects.
    this.persistence =
      opts.persist !== false && typeof indexedDB !== 'undefined'
        ? new IndexeddbPersistence(`collabdoc:${opts.documentId}`, this.doc)
        : null

    // WebsocketProvider appends the room name to the URL. We pass the JWT in
    // `params` so the backend can authorize the upgrade in `?token=`.
    this.wsProvider = new WebsocketProvider(opts.wsUrl, opts.documentId, this.doc, {
      params: { token: opts.token },
      connect: true,
    })

    this.wsProvider.on('status', (e: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      this.setStatus(e.status)
    })

    this.wsProvider.on('sync', (isSynced: boolean) => {
      if (isSynced && !this.synced) {
        this.synced = true
        this.listeners.forEach(l => l.onSynced?.())
      }
    })
  }

  get awareness() {
    return this.wsProvider.awareness
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  isSynced(): boolean {
    return this.synced
  }

  subscribe(listener: YjsListener): () => void {
    this.listeners.push(listener)
    // Fire current status immediately so new subscribers render correctly.
    listener.onStatusChange?.(this.status)
    if (this.synced) listener.onSynced?.()
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  setLocalAwareness(state: Record<string, unknown>) {
    this.awareness.setLocalState(state)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.listeners = []
    this.wsProvider.destroy()
    this.persistence?.destroy()
    this.doc.destroy()
  }

  private setStatus(next: ConnectionStatus) {
    if (this.status === next) return
    this.status = next
    this.listeners.forEach(l => l.onStatusChange?.(next))
  }
}
