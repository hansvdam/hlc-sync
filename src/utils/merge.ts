import type { Ticket } from '../types'
import { compareHLC } from './hlc'

/**
 * Merge remote tickets into local tickets
 * Returns merged tickets and conflict information for logging
 */
export function mergeTickets(
  local: Ticket[],
  remote: Ticket[]
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
      ticketMap.set(remoteTicket.id, remoteTicket)
    } else {
      // Merge fields
      const mergedFields: Ticket['fields'] = { ...localTicket.fields }

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
