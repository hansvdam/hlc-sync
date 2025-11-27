import { create } from 'zustand'
import type { NodeState, Ticket, SyncMessage, LogEntry, NodeId, HLCTimestamp, FieldUpdateMessage, TicketCreateMessage, RejectionRule, RejectionCondition, RejectionMessage } from '../types'
import { createHLCField, createHLC, getMaxHLCFromTickets, formatHLC } from '../utils/hlc'
import { mergeTickets, mergeFieldUpdate, type ConflictInfo } from '../utils/merge'
import { v4 as uuidv4 } from 'uuid'

// Rejection evaluation types and helpers
interface EvaluationContext {
  incomingField: string   // The field being updated
  incomingValue: string   // The new value
  existingTicket: Ticket | undefined  // The current ticket state (if exists)
}

/**
 * Get the value to check based on condition source
 */
function getConditionValue(
  condition: RejectionCondition,
  side: 'left' | 'right',
  ctx: EvaluationContext
): string | undefined {
  if (side === 'left') {
    // Left side is always source + field from condition
    if (condition.source === 'incoming') {
      // Only the field being updated is available as "incoming"
      if (condition.field === ctx.incomingField) {
        return ctx.incomingValue
      }
      return undefined // Can't check other incoming fields
    } else {
      // existing
      if (!ctx.existingTicket) return undefined
      const field = ctx.existingTicket.fields[condition.field as keyof Ticket['fields']]
      return field?.value
    }
  } else {
    // Right side: either literal value or compareToField
    if (condition.value !== undefined) {
      return condition.value
    }
    if (condition.compareToField) {
      if (condition.compareToField.source === 'incoming') {
        if (condition.compareToField.field === ctx.incomingField) {
          return ctx.incomingValue
        }
        return undefined
      } else {
        if (!ctx.existingTicket) return undefined
        const field = ctx.existingTicket.fields[condition.compareToField.field as keyof Ticket['fields']]
        return field?.value
      }
    }
    return undefined
  }
}

/**
 * Evaluate a single condition
 */
function evaluateCondition(condition: RejectionCondition, ctx: EvaluationContext): boolean {
  const leftValue = getConditionValue(condition, 'left', ctx)
  const rightValue = getConditionValue(condition, 'right', ctx)

  // If we can't get values, condition doesn't match
  if (leftValue === undefined || rightValue === undefined) return false

  switch (condition.operator) {
    case 'equals':
      return leftValue === rightValue
    case 'not_equals':
      return leftValue !== rightValue
    default:
      return false
  }
}

/**
 * Evaluate if a field update should be rejected based on rejection rules
 * Returns the matching rule if rejected, null if allowed
 */
function evaluateRejectionRules(
  rules: RejectionRule[] | undefined,
  ctx: EvaluationContext
): RejectionRule | null {
  if (!rules) return null

  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.conditions.length === 0) continue

    // All conditions must match (AND logic)
    const allMatch = rule.conditions.every(cond => evaluateCondition(cond, ctx))
    if (allMatch) return rule
  }
  return null
}

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
  addLog: (nodeId: NodeId, action: string, details: string, data?: any) => void
  clearLogs: () => void
  resetSimulator: () => void
  updateMessageProgress: (messageId: string, progress: number) => void
  deliverMessage: (messageId: string) => void
  clearModifiedTickets: (nodeId: NodeId) => void
  setFieldHighlight: (nodeId: NodeId, updates: Array<{ ticketId: string, field: string, isStale?: boolean }>) => void
  clearFieldHighlight: (nodeId: NodeId, updates: Array<{ ticketId: string, field: string }>) => void
  setRejectionRules: (rules: RejectionRule[]) => void
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
    isAppOnline: true, // Defaults to auto processing for all nodes
    tickets,
    inbox: [],
    outbox: [],
    modifiedTicketIds: [],
    modifiedFields: {},
    lastHLC,
    serverRevision: nodeId === 'server' ? 0 : undefined,
    eventBuffer: nodeId === 'server' ? [] : undefined,
    rejectionRules: nodeId === 'server' ? [
      // Default rejection rule for demo: reject incoming.dummy_field === "rejected"
      {
        id: 'rule-1',
        name: 'Block rejected value',
        conditions: [{
          source: 'incoming' as const,
          field: 'dummy_field',
          operator: 'equals' as const,
          value: 'rejected'
        }],
        enabled: true
      }
    ] : undefined,
    lastSeenServerRevision: nodeId !== 'server' ? 0 : undefined,
    highlightedFields: {}
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
  messageDelay: 500, // 0.5 second default
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

    // Auto-process inbox if app is started
    if (newState) {
      get().processInbox(nodeId)
    }
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
        dummy_field: createField('') // Empty default for dummy field
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

    // Create create message
    const createMessage: TicketCreateMessage = {
      id: uuidv4(),
      from: nodeId,
      to: 'server', // Placeholder
      type: 'create',
      ticket: newTicket,
      timestamp: Date.now()
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
              { ...createMessage, revision: newRevision }
            ]
          }
        }
      }))

      // Broadcast to all clients if server is online
      if (serverState.isOnline) {
        // Send to all clients
        ['client-a', 'client-b'].forEach(clientId => {
          get().sendMessage({
            ...createMessage,
            revision: newRevision,
            to: clientId as NodeId
          })
        })
      }
    } else {
      // Send to server
      get().sendMessage({
        ...createMessage,
        to: 'server'
      })
    }
  },

  editTicketField: (nodeId, ticketId, fieldName, value) => {
    const node = get().nodes[nodeId]
    const ticket = node.tickets.find(t => t.id === ticketId)
    if (!ticket) return

    // Capture the field's current HLC before editing (for stale detection)
    const currentField = ticket.fields[fieldName as keyof typeof ticket.fields]
    const previousHlc = currentField?.hlc

    // Optimistically update highlighted fields for local edits
    get().setFieldHighlight(nodeId, [{ ticketId, field: fieldName }])

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
      hlc: newField.hlc,
      previousHlc: previousHlc  // Include the field's HLC before editing for stale detection
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
        get().addLog(message.from, 'Broadcasting Paused', 'Server is offline', message)
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
      get().addLog(message.from, 'Message Queued', `${message.type} to ${message.to}`, message)
    } else {
      // Add to in-flight messages for animation
      set(state => ({
        inFlightMessages: [...state.inFlightMessages, { ...message, progress: 0 }]
      }))
      get().addLog(message.from, 'Message Sent', `${message.type} to ${message.to}`, message)
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
      get().addLog(message.to, 'Message Dropped', `Recipient offline: ${message.type} from ${message.from}`, message)
      return
    }

    // Add to recipient's inbox
    set(state => {
      const node = state.nodes[message.to]
      let newLastSeenServerRevision = node.lastSeenServerRevision

      // If we are a client receiving a message with a revision, update our last seen revision immediately
      if (message.to !== 'server' && message.revision !== undefined) {
        newLastSeenServerRevision = Math.max(node.lastSeenServerRevision || 0, message.revision)
      }

      return {
        nodes: {
          ...state.nodes,
          [message.to]: {
            ...state.nodes[message.to],
            inbox: [...state.nodes[message.to].inbox, message],
            lastSeenServerRevision: newLastSeenServerRevision
          }
        },
        inFlightMessages: state.inFlightMessages.filter(m => m.id !== messageId)
      }
    })

    get().addLog(message.to, 'Message Received', `${message.type} from ${message.from}`, message)

    // Auto-process if recipient is client and app is running, or if server is in auto-process mode
    if (get().nodes[message.to].isAppOnline) {
      get().processInbox(message.to)
    }
  },

  processInbox: (nodeId) => {
    const node = get().nodes[nodeId]
    if (node.inbox.length === 0) return

    let currentTickets = node.tickets
    let currentHLC = node.lastHLC
    let allUpdatedFields: Array<{ ticketId: string, field: string, isStale?: boolean }> = []
    
    let currentServerRevision = node.serverRevision || 0
    let newEventBuffer = node.eventBuffer || []
    let lastSeenServerRevision = node.lastSeenServerRevision || 0

    // Process each message in inbox (using for...of to allow continue)
    for (const message of node.inbox) {
      // Update HLC based on incoming message
      let maxRemoteHLC: HLCTimestamp | undefined

      if (message.type === 'update') {
        maxRemoteHLC = message.hlc
      } else if (message.type === 'create') {
        maxRemoteHLC = getMaxHLCFromTickets([{ ...message.ticket, fields: message.ticket.fields }])
      } else if (message.type === 'rejection') {
        // Rejection messages don't update HLC - they're just notifications
        maxRemoteHLC = undefined
      } else {
        // Batch message
        maxRemoteHLC = getMaxHLCFromTickets(message.tickets)
      }

      // Update local HLC: max(local, remote, physical)
      // We treat this as a "receive" event in HLC
      currentHLC = createHLC(node.currentTime, nodeId, currentHLC, maxRemoteHLC)

      let conflicts: ConflictInfo[] = []
      let updatedFields: Array<{ ticketId: string, field: string, isStale?: boolean }> = []
      let merged: Ticket[] = currentTickets

      if (message.type === 'update') {
        let isStale = false  // Track if this edit was based on stale data

        // Server rejection check - BEFORE merge
        if (nodeId === 'server') {
          const serverNode = get().nodes['server']
          const existingTicket = currentTickets.find(t => t.id === message.entity_id)

          // Build evaluation context with incoming and existing data
          const ctx: EvaluationContext = {
            incomingField: message.field,
            incomingValue: message.value,
            existingTicket
          }

          const matchingRule = evaluateRejectionRules(serverNode.rejectionRules, ctx)

          if (matchingRule) {
            // REJECTION PATH
            currentServerRevision++

            // Format rule description for logging
            const ruleDesc = matchingRule.conditions.map(c => {
              const left = `${c.source}.${c.field}`
              const right = c.compareToField
                ? `${c.compareToField.source}.${c.compareToField.field}`
                : `"${c.value}"`
              return `${left} ${c.operator} ${right}`
            }).join(' AND ')

            // Get the existing value to send back for revert
            const existingField = existingTicket?.fields[message.field as keyof Ticket['fields']]
            const existingValue = existingField?.value ?? ''

            const rejectionMessage: RejectionMessage = {
              id: uuidv4(),
              from: 'server',
              to: message.from,
              type: 'rejection',
              timestamp: Date.now(),
              revision: currentServerRevision,
              originalMessageId: message.id,
              entity_id: message.entity_id,
              field: message.field,
              value: message.value,
              existingValue: existingValue,
              reason: `Rejected by rule: ${matchingRule.name}`,
              rule: ruleDesc
            }

            newEventBuffer = [...newEventBuffer, rejectionMessage]

            get().addLog(
              nodeId,
              'Update Rejected',
              `${message.entity_id}.${message.field} = "${message.value}" from ${message.from} - ${matchingRule.name}`
            )

            get().sendMessage(rejectionMessage)
            continue // Skip merge and broadcast for rejected messages
          }

          // Stale detection (after rejection check passes)
          const existingField = existingTicket?.fields[message.field as keyof Ticket['fields']]
          const serverCurrentHlc = existingField?.hlc

          if (message.previousHlc && serverCurrentHlc) {
            // Any difference in HLC means stale (client didn't have latest)
            isStale = (
              message.previousHlc.timestamp !== serverCurrentHlc.timestamp ||
              message.previousHlc.counter !== serverCurrentHlc.counter ||
              message.previousHlc.nodeId !== serverCurrentHlc.nodeId
            )

            if (isStale) {
              const previousInfo = formatHLC(message.previousHlc)
              const currentInfo = formatHLC(serverCurrentHlc)

              get().addLog(
                nodeId,
                'Stale Edit Detected',
                `${message.entity_id}.${message.field} - Client had HLC=${previousInfo}, Server has HLC=${currentInfo}`
              )
            }
          }
        }

        // ACCEPTANCE PATH - Single field update
        const result = mergeFieldUpdate(currentTickets, message)
        merged = result.merged
        conflicts = result.conflicts
        // Tag updated fields with stale info for highlight system
        // Server: use locally computed isStale, Client: use wasStale from broadcast
        const staleFlag = nodeId === 'server' ? isStale : (message.wasStale ?? false)
        updatedFields = result.updatedFields.map(f => ({ ...f, isStale: staleFlag }))

        get().addLog(nodeId, 'Message Processed', `Update ${message.entity_id}.${message.field} = "${message.value}" from ${message.from}`, message)

        // Log conflicts immediately
        conflicts.forEach(conflict => {
          const localInfo = conflict.localHLC ? formatHLC(conflict.localHLC) : 'none'
          const remoteInfo = conflict.remoteHLC ? formatHLC(conflict.remoteHLC) : 'none'

          get().addLog(
            nodeId,
            'Conflict Resolved',
            `${conflict.ticketId}.${conflict.field} - Winner: ${conflict.winner} (${conflict.reason}). HLCs: Local=${localInfo} vs Remote=${remoteInfo}`
          )
        })

        // If server, broadcast to other clients
        if (nodeId === 'server') {
          currentServerRevision++
          const messageWithRevision = {
            ...message,
            revision: currentServerRevision,
            wasStale: isStale  // Include stale flag in broadcast
          }
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

      } else if (message.type === 'create') {
        // Create ticket
        // Treat as merging a full ticket (similar to batch but for one)
        // Casting Ticket to TicketDelta-like structure for mergeTickets if needed, or just pass array
        const result = mergeTickets(currentTickets, [message.ticket])
        merged = result.merged
        conflicts = result.conflicts
        updatedFields = result.updatedFields
        get().addLog(nodeId, 'Message Processed', `Created ticket ${message.ticket.id} from ${message.from}`, message)

        // Log conflicts immediately
        conflicts.forEach(conflict => {
          const localInfo = conflict.localHLC ? formatHLC(conflict.localHLC) : 'none'
          const remoteInfo = conflict.remoteHLC ? formatHLC(conflict.remoteHLC) : 'none'

          get().addLog(
            nodeId,
            'Conflict Resolved',
            `${conflict.ticketId}.${conflict.field} - Winner: ${conflict.winner} (${conflict.reason}). HLCs: Local=${localInfo} vs Remote=${remoteInfo}`
          )
        })

        // If server, broadcast to other clients
        if (nodeId === 'server') {
          currentServerRevision++
          const messageWithRevision = { ...message, revision: currentServerRevision }
          newEventBuffer = [...newEventBuffer, messageWithRevision];

          ['client-a', 'client-b'].forEach(clientId => {
            // Send to all clients
            if (clientId !== message.from) {
              get().sendMessage({
                ...messageWithRevision,
                id: uuidv4(),
                from: 'server',
                to: clientId as NodeId,
              })
            } else {
                // Also send back to creator to confirm revision? 
                // In original update logic: "Send to all clients, including sender (to confirm revision)"
                get().sendMessage({
                ...messageWithRevision,
                id: uuidv4(),
                from: 'server',
                to: clientId as NodeId,
              })
            }
          })
        }
      } else if (message.type === 'rejection') {
        // Client receives rejection notification - revert to server's value
        get().addLog(
          nodeId,
          'Update Rejected by Server',
          `${message.entity_id}.${message.field} = "${message.value}" - ${message.reason} (reverting to "${message.existingValue}")`,
          message
        )

        // Revert the field to the server's existing value
        const ticketIndex = currentTickets.findIndex(t => t.id === message.entity_id)
        if (ticketIndex !== -1) {
          const ticket = currentTickets[ticketIndex]
          const fieldKey = message.field as keyof Ticket['fields']
          if (ticket.fields[fieldKey]) {
            // Update the field value but keep the existing HLC (since we're reverting)
            const updatedTicket = {
              ...ticket,
              fields: {
                ...ticket.fields,
                [fieldKey]: {
                  ...ticket.fields[fieldKey],
                  value: message.existingValue
                }
              }
            }
            currentTickets = [
              ...currentTickets.slice(0, ticketIndex),
              updatedTicket,
              ...currentTickets.slice(ticketIndex + 1)
            ]
            merged = currentTickets
            updatedFields = [{ ticketId: message.entity_id, field: message.field }]
          }
        }
      } else {
        // Batch update
        const result = mergeTickets(currentTickets, message.tickets as Ticket[])
        merged = result.merged
        conflicts = result.conflicts
        updatedFields = result.updatedFields
        get().addLog(nodeId, 'Message Processed', `Merged ${message.tickets.length} tickets from ${message.from}`, message)

        // Log conflicts immediately
        conflicts.forEach(conflict => {
          const localInfo = conflict.localHLC ? formatHLC(conflict.localHLC) : 'none'
          const remoteInfo = conflict.remoteHLC ? formatHLC(conflict.remoteHLC) : 'none'

          get().addLog(
            nodeId,
            'Conflict Resolved',
            `${conflict.ticketId}.${conflict.field} - Winner: ${conflict.winner} (${conflict.reason}). HLCs: Local=${localInfo} vs Remote=${remoteInfo}`
          )
        })
      }

      currentTickets = merged
      // Conflicts already logged, no need to accumulate for later logging
      // allConflicts = [...allConflicts, ...conflicts]
      allUpdatedFields = [...allUpdatedFields, ...updatedFields]
    }

    // Highlight updated fields
    if (allUpdatedFields.length > 0) {
      get().setFieldHighlight(nodeId, allUpdatedFields)
    }

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

  addLog: (nodeId, action, details, data) => {
    set(state => ({
      logs: [
        ...state.logs,
        {
          timestamp: Date.now(),
          nodeId,
          action,
          details,
          data
        }
      ]
    }))
  },

  clearLogs: () => {
    set({ logs: [] })
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
  },

  setFieldHighlight: (nodeId, updates) => {
    set(state => {
      const newHighlights = { ...state.nodes[nodeId].highlightedFields }
      updates.forEach(({ ticketId, field, isStale }) => {
        newHighlights[`${ticketId}:${field}`] = { isStale: isStale ?? false }
      })

      return {
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...state.nodes[nodeId],
            highlightedFields: newHighlights
          }
        }
      }
    })

    // Set timeout to clear highlights
    setTimeout(() => {
      get().clearFieldHighlight(nodeId, updates)
    }, 1000)
  },

  clearFieldHighlight: (nodeId, updates) => {
    set(state => {
      const newHighlights = { ...state.nodes[nodeId].highlightedFields }
      updates.forEach(({ ticketId, field }) => {
        delete newHighlights[`${ticketId}:${field}`]
      })

      return {
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...state.nodes[nodeId],
            highlightedFields: newHighlights
          }
        }
      }
    })
  },

  setRejectionRules: (rules) => {
    set(state => ({
      nodes: {
        ...state.nodes,
        server: {
          ...state.nodes.server,
          rejectionRules: rules
        }
      }
    }))
    get().addLog('server', 'Rules Updated', `Set ${rules.filter(r => r.enabled).length} active rejection rules`)
  }
}})
