import { create } from 'zustand'
import type { NodeState, Ticket, SyncMessage, LogEntry, NodeId } from '../types'
import { createHLCField } from '../utils/hlc'
import { mergeTickets } from '../utils/merge'
import { v4 as uuidv4 } from 'uuid'

interface InFlightMessage extends SyncMessage {
  progress: number // 0 to 1 for animation
}

interface SimulatorState {
  // Node states
  nodes: Record<NodeId, NodeState>

  // Messages currently being delivered (for animation)
  inFlightMessages: InFlightMessage[]

  // Message delay in milliseconds
  messageDelay: number

  // Operation log
  logs: LogEntry[]

  // Actions
  updateNodeTime: (nodeId: NodeId, time: number) => void
  toggleDeviceOnline: (nodeId: NodeId) => void
  toggleAppOnline: (nodeId: NodeId) => void
  createTicket: (nodeId: NodeId) => void
  editTicketField: (nodeId: NodeId, ticketId: string, fieldName: string, value: string) => void
  sendMessage: (message: SyncMessage) => void
  processInbox: (nodeId: NodeId) => void
  addLog: (nodeId: NodeId, action: string, details: string) => void
  resetSimulator: () => void
  updateMessageProgress: (messageId: string, progress: number) => void
  deliverMessage: (messageId: string) => void
}

// Initial dummy tickets
const createInitialTickets = (nodeId: NodeId): Ticket[] => {
  const baseTime = Date.now()
  return [
    {
      id: 'ticket-1',
      fields: {
        ticket_name: createHLCField('Ticket 1', baseTime, nodeId),
        dummy_field: createHLCField('Dummy value 1', baseTime, nodeId)
      }
    },
    {
      id: 'ticket-2',
      fields: {
        ticket_name: createHLCField('Ticket 2', baseTime, nodeId),
        dummy_field: createHLCField('Dummy value 2', baseTime, nodeId)
      }
    },
    {
      id: 'ticket-3',
      fields: {
        ticket_name: createHLCField('Ticket 3', baseTime, nodeId),
        dummy_field: createHLCField('Dummy value 3', baseTime, nodeId)
      }
    }
  ]
}

const createInitialNodeState = (nodeId: NodeId): NodeState => ({
  nodeId,
  currentTime: Date.now(),
  isOnline: true,
  isAppOnline: true,
  tickets: createInitialTickets(nodeId),
  inbox: [],
  outbox: []
})

export const useSimulatorStore = create<SimulatorState>((set, get) => ({
  nodes: {
    'client-a': createInitialNodeState('client-a'),
    'client-b': createInitialNodeState('client-b'),
    'server': createInitialNodeState('server')
  },

  inFlightMessages: [],
  messageDelay: 2000, // 2 seconds default
  logs: [],

  updateNodeTime: (nodeId, time) => {
    set(state => ({
      nodes: {
        ...state.nodes,
        [nodeId]: { ...state.nodes[nodeId], currentTime: time }
      }
    }))
    get().addLog(nodeId, 'Time Updated', `Set to ${time}`)
  },

  toggleDeviceOnline: (nodeId) => {
    set(state => ({
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...state.nodes[nodeId],
          isOnline: !state.nodes[nodeId].isOnline
        }
      }
    }))
    const newState = get().nodes[nodeId].isOnline
    get().addLog(nodeId, 'Device Status', newState ? 'Online' : 'Offline')
  },

  toggleAppOnline: (nodeId) => {
    set(state => ({
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...state.nodes[nodeId],
          isAppOnline: !state.nodes[nodeId].isAppOnline
        }
      }
    }))
    const newState = get().nodes[nodeId].isAppOnline
    get().addLog(nodeId, 'App Status', newState ? 'Running' : 'Stopped')
  },

  createTicket: (nodeId) => {
    const node = get().nodes[nodeId]
    const ticketCount = node.tickets.length + 1
    const newTicketId = `ticket-${Date.now()}`

    const newTicket: Ticket = {
      id: newTicketId,
      fields: {
        ticket_name: createHLCField(`New Ticket ${ticketCount}`, node.currentTime, nodeId),
        dummy_field: createHLCField('New dummy value', node.currentTime, nodeId)
      }
    }

    set(state => ({
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...state.nodes[nodeId],
          tickets: [...state.nodes[nodeId].tickets, newTicket]
        }
      }
    }))

    get().addLog(nodeId, 'Ticket Created', `Created ${newTicketId}`)
  },

  editTicketField: (nodeId, ticketId, fieldName, value) => {
    const node = get().nodes[nodeId]
    const ticket = node.tickets.find(t => t.id === ticketId)
    if (!ticket) return

    // Get last HLC from any field in the ticket
    const lastHLC = ticket.fields.ticket_name.hlc

    // Create new field value with HLC
    const newField = createHLCField(value, node.currentTime, nodeId, lastHLC)

    set(state => ({
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...state.nodes[nodeId],
          tickets: state.nodes[nodeId].tickets.map(t =>
            t.id === ticketId
              ? {
                  ...t,
                  fields: {
                    ...t.fields,
                    [fieldName]: newField
                  }
                }
              : t
          )
        }
      }
    }))

    get().addLog(nodeId, 'Field Edited', `${ticketId}.${fieldName} = "${value}"`)
  },

  sendMessage: (message) => {
    // Add to in-flight messages for animation
    set(state => ({
      inFlightMessages: [...state.inFlightMessages, { ...message, progress: 0 }]
    }))
    get().addLog(message.from, 'Message Sent', `${message.type} to ${message.to}`)
  },

  updateMessageProgress: (messageId, progress) => {
    set(state => ({
      inFlightMessages: state.inFlightMessages.map(msg =>
        msg.id === messageId ? { ...msg, progress } : msg
      )
    }))
  },

  deliverMessage: (messageId) => {
    const message = get().inFlightMessages.find(m => m.id === messageId)
    if (!message) return

    // Add to recipient's inbox
    set(state => ({
      nodes: {
        ...state.nodes,
        [message.to]: {
          ...state.nodes[message.to],
          inbox: [...state.nodes[message.to].inbox, message]
        }
      },
      inFlightMessages: state.inFlightMessages.filter(m => m.id !== messageId)
    }))

    get().addLog(message.to, 'Message Received', `${message.type} from ${message.from}`)
  },

  processInbox: (nodeId) => {
    const node = get().nodes[nodeId]
    if (node.inbox.length === 0) return

    let currentTickets = node.tickets
    let allConflicts: Array<{ ticketId: string, field: string, winner: string }> = []

    // Process each message in inbox
    node.inbox.forEach(message => {
      const { merged, conflicts } = mergeTickets(currentTickets, message.tickets)
      currentTickets = merged
      allConflicts = [...allConflicts, ...conflicts]

      get().addLog(nodeId, 'Message Processed', `Merged ${message.tickets.length} tickets from ${message.from}`)
    })

    // Log conflicts
    allConflicts.forEach(conflict => {
      get().addLog(
        nodeId,
        'Conflict Resolved',
        `${conflict.ticketId}.${conflict.field} - Winner: ${conflict.winner}`
      )
    })

    // Update node state
    set(state => ({
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...state.nodes[nodeId],
          tickets: currentTickets,
          inbox: [] // Clear inbox
        }
      }
    }))

    // If this is the server, broadcast to all clients
    if (nodeId === 'server') {
      const clients: NodeId[] = ['client-a', 'client-b']
      clients.forEach(clientId => {
        const client = get().nodes[clientId]
        if (client.isOnline && client.isAppOnline) {
          const broadcastMessage = {
            id: uuidv4(),
            from: 'server' as NodeId,
            to: clientId,
            type: 'broadcast' as const,
            tickets: currentTickets,
            timestamp: Date.now()
          }
          get().sendMessage(broadcastMessage)
        }
      })
    }

    get().addLog(nodeId, 'Inbox Cleared', `Processed ${node.inbox.length} messages`)
  },

  addLog: (nodeId, action, details) => {
    set(state => ({
      logs: [
        ...state.logs,
        {
          timestamp: Date.now(),
          nodeId,
          action,
          details
        }
      ]
    }))
  },

  resetSimulator: () => {
    set({
      nodes: {
        'client-a': createInitialNodeState('client-a'),
        'client-b': createInitialNodeState('client-b'),
        'server': createInitialNodeState('server')
      },
      inFlightMessages: [],
      logs: []
    })
    get().addLog('server', 'System', 'Simulator reset')
  }
}))
