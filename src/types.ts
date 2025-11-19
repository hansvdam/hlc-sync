// HLC timestamp structure
export interface HLCTimestamp {
  timestamp: number  // Physical time component
  counter: number    // Logical counter for same timestamp
  nodeId: string     // Node identifier (client-a, client-b, server)
}

// Field with HLC tracking
export interface HLCField<T> {
  value: T
  hlc: HLCTimestamp
}

// Ticket structure
export interface Ticket {
  id: string
  fields: {
    ticket_name: HLCField<string>
    dummy_field: HLCField<string>
  }
}

// Node types
export type NodeId = 'client-a' | 'client-b' | 'server'

// Message types for sync
export type MessageType = 'push' | 'pull' | 'broadcast'

export interface SyncMessage {
  id: string
  from: NodeId
  to: NodeId
  type: MessageType
  tickets: Ticket[]
  timestamp: number  // When message was created
}

// Node state
export interface NodeState {
  nodeId: NodeId
  currentTime: number  // Static time that can be edited
  isOnline: boolean    // Device-level connectivity
  isAppOnline: boolean // App-level running state
  tickets: Ticket[]
  inbox: SyncMessage[]
  outbox: SyncMessage[]
}

// Log entry
export interface LogEntry {
  timestamp: number
  nodeId: NodeId
  action: string
  details: string
}
