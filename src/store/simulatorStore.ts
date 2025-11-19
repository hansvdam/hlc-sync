import { create } from 'zustand'
import type { NodeState, Ticket, SyncMessage, LogEntry, NodeId, HLCTimestamp, FieldUpdateMessage } from '../types'
import { createHLCField, createHLC, getMaxHLCFromTickets } from '../utils/hlc'
import { mergeTickets, mergeFieldUpdate } from '../utils/merge'
import { v4 as uuidv4 } from 'uuid'

type InFlightMessage = SyncMessage & {
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
  
  // Initial tickets are created by server at baseTime - 10
  const initialTicketHLC: HLCTimestamp = {
    timestamp: baseTime - 10,
    counter: 0,
    nodeId: 'server'
  }
  
  const createField = (val: string) => {
     // Use the fixed initialTicketHLC for all initial fields
     return {
       value: val,
       hlc: initialTicketHLC
     }
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

const createInitialNodeState = (nodeId: NodeId, initialTime?: number, dataTime?: number): NodeState => {
  const now = initialTime ?? Date.now()
  // Use dataTime if provided, otherwise use now. 
  // For synchronized start, dataTime should be the same across nodes.
  const ticketTime = dataTime ?? now
  const { tickets, lastHLC } = createInitialTickets(nodeId, ticketTime)
  
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
    lastHLC,
    serverRevision: nodeId === 'server' ? 0 : undefined,
    eventBuffer: nodeId === 'server' ? [] : undefined,
    lastSeenServerRevision: nodeId !== 'server' ? 0 : undefined
  }
}

export const useSimulatorStore = create<SimulatorState>((set, get) => {
  const now = Date.now()
  return {
  nodes: {
    'client-a': createInitialNodeState('client-a', now + 1, now),
    'client-b': createInitialNodeState('client-b', now + 1, now),
    'server': createInitialNodeState('server', now, now)
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

    // Flush outbox if coming online
    if (newState) {
      const node = get().nodes[nodeId]
      if (node.outbox.length > 0) {
        const messagesToSend = node.outbox
        set(state => ({
          nodes: {
            ...state.nodes,
            [nodeId]: {
              ...state.nodes[nodeId],
              outbox: []
            }
          },
          inFlightMessages: [
            ...state.inFlightMessages,
            ...messagesToSend.map(msg => ({ ...msg, progress: 0 }))
          ]
        }))
        get().addLog(nodeId, 'Outbox Flushed', `Sent ${messagesToSend.length} messages`)
      }

      // Fetch missing messages from server
      if (nodeId !== 'server') {
        const server = get().nodes['server']
        const client = get().nodes[nodeId]
        const lastSeen = client.lastSeenServerRevision || 0
        
        const missingMessages = server.eventBuffer?.filter(msg => (msg.revision || 0) > lastSeen) || []
        
        if (missingMessages.length > 0) {
          const fetchMessages = missingMessages.map(msg => ({
            ...msg,
            id: uuidv4(),
            to: nodeId,
            progress: 0
          }))
          
          set(state => ({
            inFlightMessages: [
              ...state.inFlightMessages,
              ...fetchMessages
            ]
          }))
          
          get().addLog(nodeId, 'Fetching Events', `Requesting ${missingMessages.length} missed events`)
        }
      }
    }
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

    // Send update messages for each field
    Object.entries(newTicket.fields).forEach(([fieldName, field]) => {
      const updateMessage: FieldUpdateMessage = {
        id: uuidv4(),
        from: nodeId,
        to: 'server', // Placeholder
        type: 'update',
        entity_id: newTicketId,
        field: fieldName,
        value: field.value,
        timestamp: Date.now(),
        hlc: field.hlc
      }

      if (nodeId === 'server') {
        // Server Logic: Increment revision, add to buffer
        const serverState = get().nodes['server']
        const newRevision = (serverState.serverRevision || 0) + 1
        
        set(state => ({
          nodes: {
            ...state.nodes,
            server: {
              ...state.nodes.server,
              serverRevision: newRevision,
              eventBuffer: [
                ...(state.nodes.server.eventBuffer || []),
                { ...updateMessage, revision: newRevision }
              ]
            }
          }
        }))

        // Broadcast to all clients if server is online
        if (serverState.isOnline) {
          // Send to all clients, including sender (to confirm revision)
          ['client-a', 'client-b'].forEach(clientId => {
            get().sendMessage({
              ...updateMessage,
              revision: newRevision,
              to: clientId as NodeId
            })
          })
        }
      } else {
        // Send to server
        get().sendMessage({
          ...updateMessage,
          to: 'server'
        })
      }
    })
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

    // Send update message
    const updateMessage: FieldUpdateMessage = {
      id: uuidv4(),
      from: nodeId,
      to: 'server', // Placeholder, will be overwritten in loop below
      type: 'update',
      entity_id: ticketId,
      field: fieldName,
      value: value,
      timestamp: Date.now(),
      hlc: newField.hlc
    }

    if (nodeId === 'server') {
      // Server Logic: Increment revision, add to buffer
      const serverState = get().nodes['server']
      const newRevision = (serverState.serverRevision || 0) + 1
      
      set(state => ({
        nodes: {
          ...state.nodes,
          server: {
            ...state.nodes.server,
            serverRevision: newRevision,
            eventBuffer: [
              ...(state.nodes.server.eventBuffer || []),
              { ...updateMessage, revision: newRevision }
            ]
          }
        }
      }))

      // Broadcast to all clients if server is online
      if (serverState.isOnline) {
        // Send to all clients, including sender (to confirm revision)
        ['client-a', 'client-b'].forEach(clientId => {
          get().sendMessage({
            ...updateMessage,
            revision: newRevision,
            to: clientId as NodeId
          })
        })
      }
    } else {
      // Send to server
      get().sendMessage({
        ...updateMessage,
        to: 'server'
      })
    }
  },

  sendMessage: (message) => {
    const node = get().nodes[message.from]
    
    if (!node.isOnline) {
      if (message.from === 'server') {
        get().addLog(message.from, 'Broadcasting Paused', 'Server is offline')
        return
      }
      // Queue in outbox
      set(state => ({
        nodes: {
          ...state.nodes,
          [message.from]: {
            ...state.nodes[message.from],
            outbox: [...state.nodes[message.from].outbox, message]
          }
        }
      }))
      get().addLog(message.from, 'Message Queued', `${message.type} to ${message.to}`)
    } else {
      // Add to in-flight messages for animation
      set(state => ({
        inFlightMessages: [...state.inFlightMessages, { ...message, progress: 0 }]
      }))
      get().addLog(message.from, 'Message Sent', `${message.type} to ${message.to}`)
    }
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

    // Drop message if recipient is offline
    const recipient = get().nodes[message.to]
    if (!recipient.isOnline) {
      set(state => ({
        inFlightMessages: state.inFlightMessages.filter(m => m.id !== messageId)
      }))
      get().addLog(message.to, 'Message Dropped', `Recipient offline: ${message.type} from ${message.from}`)
      return
    }

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
    
    let currentServerRevision = node.serverRevision || 0
    let newEventBuffer = node.eventBuffer || []
    let lastSeenServerRevision = node.lastSeenServerRevision || 0

    // Process each message in inbox
    node.inbox.forEach(message => {
      // Track revision for clients
      if (nodeId !== 'server' && message.revision) {
        lastSeenServerRevision = Math.max(lastSeenServerRevision, message.revision)
      }

      // Update HLC based on incoming message
      let maxRemoteHLC: HLCTimestamp | undefined
      
      if (message.type === 'update') {
        maxRemoteHLC = message.hlc
      } else {
        // Batch message
        maxRemoteHLC = getMaxHLCFromTickets(message.tickets)
      }
      
      // Update local HLC: max(local, remote, physical)
      // We treat this as a "receive" event in HLC
      currentHLC = createHLC(node.currentTime, nodeId, currentHLC, maxRemoteHLC)

      let conflicts: Array<{ ticketId: string, field: string, winner: string }> = []
      let merged: Ticket[] = currentTickets

      if (message.type === 'update') {
        // Single field update
        const result = mergeFieldUpdate(currentTickets, message)
        merged = result.merged
        conflicts = result.conflicts
        
        get().addLog(nodeId, 'Message Processed', `Update ${message.entity_id}.${message.field} from ${message.from}`)

        // If server, broadcast to other clients
        if (nodeId === 'server') {
          currentServerRevision++
          const messageWithRevision = { ...message, revision: currentServerRevision }
          newEventBuffer = [...newEventBuffer, messageWithRevision];

          ['client-a', 'client-b'].forEach(clientId => {
            // Send to all clients, including sender (to confirm revision)
            get().sendMessage({
              ...messageWithRevision,
              id: uuidv4(),
              from: 'server',
              to: clientId as NodeId,
            })
          })
        }

      } else {
        // Batch update
        const result = mergeTickets(currentTickets, message.tickets as Ticket[])
        merged = result.merged
        conflicts = result.conflicts
        get().addLog(nodeId, 'Message Processed', `Merged ${message.tickets.length} tickets from ${message.from}`)
      }

      currentTickets = merged
      allConflicts = [...allConflicts, ...conflicts]
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
          lastHLC: currentHLC,
          serverRevision: nodeId === 'server' ? currentServerRevision : undefined,
          eventBuffer: nodeId === 'server' ? newEventBuffer : undefined,
          lastSeenServerRevision: nodeId !== 'server' ? lastSeenServerRevision : undefined
        }
      }
    }))
    
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
    const now = Date.now()
    set({
      nodes: {
        'client-a': createInitialNodeState('client-a', now + 1, now),
        'client-b': createInitialNodeState('client-b', now + 1, now),
        'server': createInitialNodeState('server', now, now)
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
}})
