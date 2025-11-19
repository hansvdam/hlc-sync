import { create } from 'zustand'
import type { NodeState, Ticket, SyncMessage, LogEntry, NodeId, TicketDelta, HLCTimestamp } from '../types'
import { createHLCField, createHLC, getMaxHLCFromTickets } from '../utils/hlc'
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
  clearModifiedTickets: (nodeId: NodeId) => void
}

// Initial dummy tickets
const createInitialTickets = (nodeId: NodeId, baseTime: number): { tickets: Ticket[], lastHLC: HLCTimestamp } => {
  const baseHLC: HLCTimestamp = { timestamp: baseTime, counter: 0, nodeId }
  
  const createField = (val: string) => {
     // Use the base HLC for all initial fields so they don't increment the counter
     // We do NOT update baseHLC here.
     return createHLCField(val, baseTime, nodeId, baseHLC)
  }

  const tickets = [
    {
      id: 'ticket-1',
      fields: {
        ticket_name: createField('Ticket 1'),
        dummy_field: createField('Dummy value 1')
      }
    },
    {
      id: 'ticket-2',
      fields: {
        ticket_name: createField('Ticket 2'),
        dummy_field: createField('Dummy value 2')
      }
    },
    {
      id: 'ticket-3',
      fields: {
        ticket_name: createField('Ticket 3'),
        dummy_field: createField('Dummy value 3')
      }
    }
  ]
  
  return { tickets, lastHLC: baseHLC }
}

const createInitialNodeState = (nodeId: NodeId): NodeState => {
  const now = Date.now()
  const { tickets, lastHLC } = createInitialTickets(nodeId, now)
  
  return {
    nodeId,
    currentTime: now,
    isOnline: true,
    isAppOnline: true,
    tickets,
    inbox: [],
    outbox: [],
    modifiedTicketIds: [],
    modifiedFields: {},
    lastHLC
  }
}

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
    
    let currentHLC = node.lastHLC
    
    const createField = (val: string) => {
      const field = createHLCField(val, node.currentTime, nodeId, currentHLC)
      currentHLC = field.hlc
      return field
    }

    const newTicket: Ticket = {
      id: newTicketId,
      fields: {
        ticket_name: createField(`New Ticket ${ticketCount}`),
        dummy_field: createField('New dummy value')
      }
    }

    set(state => ({
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...state.nodes[nodeId],
          tickets: [...state.nodes[nodeId].tickets, newTicket],
          modifiedTicketIds: [...state.nodes[nodeId].modifiedTicketIds, newTicketId],
          // New tickets are fully modified
          modifiedFields: {
            ...state.nodes[nodeId].modifiedFields,
            [newTicketId]: Object.keys(newTicket.fields)
          },
          lastHLC: currentHLC
        }
      }
    }))

    get().addLog(nodeId, 'Ticket Created', `Created ${newTicketId}`)
  },

  editTicketField: (nodeId, ticketId, fieldName, value) => {
    const node = get().nodes[nodeId]
    const ticket = node.tickets.find(t => t.id === ticketId)
    if (!ticket) return

    // Use node.lastHLC instead of ticket field's HLC
    const lastHLC = node.lastHLC

    // Create new field value with HLC
    const newField = createHLCField(value, node.currentTime, nodeId, lastHLC)

    const currentModifiedFields = node.modifiedFields[ticketId] || []
    
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
          ),
          modifiedTicketIds: state.nodes[nodeId].modifiedTicketIds.includes(ticketId)
            ? state.nodes[nodeId].modifiedTicketIds
            : [...state.nodes[nodeId].modifiedTicketIds, ticketId],
          modifiedFields: {
            ...state.nodes[nodeId].modifiedFields,
            [ticketId]: currentModifiedFields.includes(fieldName) 
              ? currentModifiedFields 
              : [...currentModifiedFields, fieldName]
          },
          lastHLC: newField.hlc
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
    let currentHLC = node.lastHLC

    // Process each message in inbox
    node.inbox.forEach(message => {
      // Update HLC based on incoming message
      // Find max HLC in incoming message
      const maxRemoteHLC = getMaxHLCFromTickets(message.tickets)
      
      // Update local HLC: max(local, remote, physical)
      // We treat this as a "receive" event in HLC
      currentHLC = createHLC(node.currentTime, nodeId, currentHLC, maxRemoteHLC)

      // Since we are now working with partial tickets (deltas), we need to cast or ensure mergeTickets handles them
      // In mergeTickets, we iterate over remote fields anyway.
      const { merged, conflicts } = mergeTickets(currentTickets, message.tickets as Ticket[])
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
          inbox: [], // Clear inbox
          lastHLC: currentHLC
        }
      }
    }))

    // If this is the server, broadcast to all clients
    if (nodeId === 'server') {
      const clients: NodeId[] = ['client-a', 'client-b']
      clients.forEach(clientId => {
        const client = get().nodes[clientId]
        if (client.isOnline && client.isAppOnline) {
          // For broadcast, we usually send the full state of changed tickets or everything
          // But here we are broadcasting the *result* of the merge.
          // The simulator logic was sending "currentTickets" which is EVERYTHING.
          // The user wants "A message from a client should actually only be a modification to a single field"
          // But that applies to PUSH (client -> server). 
          // Broadcast (server -> client) might still be full state or deltas.
          // Let's keep broadcast as full state for now unless requested otherwise, 
          // OR better yet, broadcast only what changed. But simpler to keep as is for server.
          // Wait, the type `SyncMessage` now expects `TicketDelta[]`.
          // So we should convert `currentTickets` to `TicketDelta[]` which is compatible (Ticket extends TicketDelta effectively)
          
          const broadcastMessage = {
            id: uuidv4(),
            from: 'server' as NodeId,
            to: clientId,
            type: 'broadcast' as const,
            tickets: currentTickets, // This sends full tickets, which is valid TicketDelta
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
  },

  clearModifiedTickets: (nodeId) => {
    set(state => ({
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...state.nodes[nodeId],
          modifiedTicketIds: [],
          modifiedFields: {} // Clear modified fields too
        }
      }
    }))
  }
}))
