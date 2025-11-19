import type { Ticket, FieldUpdateMessage, TicketDelta, HLCField } from '../types'
import { compareHLC } from './hlc'

/**
 * Merge remote tickets into local tickets
 * Returns merged tickets and conflict information for logging
 */
export function mergeTickets(
  local: Ticket[],
  remote: TicketDelta[] | Ticket[]
): {
  merged: Ticket[]
  conflicts: Array<{ ticketId: string, field: string, winner: string }>
} {
  const conflicts: Array<{ ticketId: string, field: string, winner: string }> = []
  const ticketMap = new Map<string, Ticket>()

  // Start with local tickets
  local.forEach(ticket => {
    ticketMap.set(ticket.id, ticket)
  })

  // Merge in remote tickets
  remote.forEach(remoteTicket => {
    const localTicket = ticketMap.get(remoteTicket.id)

    if (!localTicket) {
      // New ticket from remote
      // We need to be careful here - if it's a delta, we might not have all fields.
      // But for now we assume we can just accept it. 
      // Ideally we'd need a full ticket creation if it doesn't exist.
      // If it's a TicketDelta, we cast it to Ticket (risky but assuming for now)
      ticketMap.set(remoteTicket.id, remoteTicket as Ticket)
    } else {
      // Merge fields
      const mergedFields: Ticket['fields'] = { ...localTicket.fields }

      if (remoteTicket.fields) {
        Object.keys(remoteTicket.fields).forEach(fieldName => {
          const localField = localTicket.fields[fieldName as keyof typeof localTicket.fields]
          const remoteField = remoteTicket.fields[fieldName as keyof typeof remoteTicket.fields]

          if (localField && remoteField) {
            const comparison = compareHLC(localField.hlc, remoteField.hlc)

            if (comparison < 0) {
              // Remote wins
              mergedFields[fieldName as keyof typeof mergedFields] = remoteField
              conflicts.push({
                ticketId: remoteTicket.id,
                field: fieldName,
                winner: remoteField.hlc.nodeId
              })
            } else if (comparison > 0) {
              // Local wins (already in mergedFields)
              conflicts.push({
                ticketId: remoteTicket.id,
                field: fieldName,
                winner: localField.hlc.nodeId
              })
            }
            // If equal, no conflict (same value)
          }
        })
      }

      ticketMap.set(remoteTicket.id, {
        ...localTicket,
        fields: mergedFields
      })
    }
  })

  return {
    merged: Array.from(ticketMap.values()),
    conflicts
  }
}

export function mergeFieldUpdate(
  local: Ticket[],
  update: FieldUpdateMessage
): {
  merged: Ticket[]
  conflicts: Array<{ ticketId: string, field: string, winner: string }>
} {
  const conflicts: Array<{ ticketId: string, field: string, winner: string }> = []
  const ticketMap = new Map<string, Ticket>()

  // Start with local tickets
  local.forEach(ticket => {
    ticketMap.set(ticket.id, ticket)
  })

  // Construct the remote field object
  const remoteField = {
    value: update.value,
    hlc: update.hlc
  }
  
  const fieldName = update.field as keyof Ticket['fields']
  const localTicket = ticketMap.get(update.entity_id)

  if (localTicket) {
    const localField = localTicket.fields[fieldName]
    
    if (localField) {
      const comparison = compareHLC(localField.hlc, remoteField.hlc)

      if (comparison < 0) {
        // Remote wins
        const mergedFields = { 
          ...localTicket.fields,
          [fieldName]: remoteField
        }
        ticketMap.set(update.entity_id, {
          ...localTicket,
          fields: mergedFields
        })
        
        conflicts.push({
          ticketId: update.entity_id,
          field: update.field,
          winner: update.hlc.nodeId
        })
      } else if (comparison > 0) {
        // Local wins - do nothing
        conflicts.push({
          ticketId: update.entity_id,
          field: update.field,
          winner: localField.hlc.nodeId
        })
      }
    }
  } else {
    // Upsert: Ticket doesn't exist locally. Create it.
    // We need to initialize other fields with some default state.
    // Since we don't know the other fields' values, we create empty fields with 0 timestamp.
    // They will be overwritten if we receive updates for them later.
    
    const createEmptyField = (): HLCField<string> => ({
      value: "",
      hlc: { timestamp: 0, counter: 0, nodeId: 'system' }
    })

    const newTicket: Ticket = {
      id: update.entity_id,
      fields: {
        ticket_name: fieldName === 'ticket_name' ? remoteField : createEmptyField(),
        dummy_field: fieldName === 'dummy_field' ? remoteField : createEmptyField()
      }
    }

    ticketMap.set(update.entity_id, newTicket)
    
    conflicts.push({
      ticketId: update.entity_id,
      field: update.field,
      winner: update.hlc.nodeId // Remote "wins" because it's a new create
    })
  }

  return {
    merged: Array.from(ticketMap.values()),
    conflicts
  }
}
