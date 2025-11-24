import type { HLCTimestamp, HLCField, TicketDelta } from '../types'

/**
 * Create a new HLC timestamp
 * @param physicalTime - Current physical time
 * @param nodeId - Node identifier
 * @param lastHLC - Last HLC timestamp from this node (optional)
 * @param remoteHLC - Remote HLC timestamp received (optional)
 */
export function createHLC(
  physicalTime: number,
  nodeId: string,
  lastHLC?: HLCTimestamp,
  remoteHLC?: HLCTimestamp
): HLCTimestamp {
  // HLC algorithm:
  // l.timestamp = max(l.timestamp, pt, msg.timestamp)
  // If l.timestamp == l.timestamp' then l.counter++ else l.counter = 0

  const maxTimestamp = Math.max(
    physicalTime,
    lastHLC?.timestamp ?? 0,
    remoteHLC?.timestamp ?? 0
  )

  let counter = 0
  if (lastHLC && lastHLC.timestamp === maxTimestamp) {
    counter = lastHLC.counter + 1
  }
  if (remoteHLC && remoteHLC.timestamp === maxTimestamp) {
    counter = Math.max(counter, remoteHLC.counter + 1)
  }

  return {
    timestamp: maxTimestamp,
    counter,
    nodeId
  }
}

/**
 * Compare two HLC timestamps
 * @returns Object containing result (-1 if a < b, 0 if equal, 1 if a > b) and reason
 */
export function compareHLC(a: HLCTimestamp, b: HLCTimestamp): { result: number, reason: string } {
  // First compare timestamps
  if (a.timestamp !== b.timestamp) {
    return {
      result: a.timestamp < b.timestamp ? -1 : 1,
      reason: `Timestamp difference: ${a.timestamp} ${a.timestamp < b.timestamp ? '<' : '>'} ${b.timestamp}`
    }
  }

  // Then compare counters
  if (a.counter !== b.counter) {
    return {
      result: a.counter < b.counter ? -1 : 1,
      reason: `Counter difference: ${a.counter} ${a.counter < b.counter ? '<' : '>'} ${b.counter}`
    }
  }

  // Finally compare node IDs (tie-breaker)
  const result = a.nodeId.localeCompare(b.nodeId)
  return {
    result: result === 0 ? 0 : (result < 0 ? -1 : 1),
    reason: result === 0 ? 'Identical HLC' : `Node ID tie-breaker: ${a.nodeId} vs ${b.nodeId}`
  }
}

/**
 * Merge two HLC fields, keeping the one with higher HLC
 */
export function mergeHLCField<T>(
  local: HLCField<T>,
  remote: HLCField<T>
): HLCField<T> {
  const comparison = compareHLC(local.hlc, remote.hlc)
  return comparison.result >= 0 ? local : remote
}

/**
 * Format HLC timestamp for display
 */
export function formatHLC(hlc: HLCTimestamp): string {
  return `${hlc.timestamp}:${hlc.counter}@${hlc.nodeId}`
}

/**
 * Create an HLC field
 */
export function createHLCField<T>(
  value: T,
  physicalTime: number,
  nodeId: string,
  lastHLC?: HLCTimestamp
): HLCField<T> {
  return {
    value,
    hlc: createHLC(physicalTime, nodeId, lastHLC)
  }
}

/**
 * Get the maximum HLC timestamp from a set of tickets
 */
export function getMaxHLCFromTickets(tickets: TicketDelta[]): HLCTimestamp | undefined {
  let maxHLC: HLCTimestamp | undefined

  tickets.forEach(ticket => {
    Object.values(ticket.fields).forEach(field => {
      if (field && field.hlc) {
        if (!maxHLC || compareHLC(field.hlc, maxHLC).result > 0) {
          maxHLC = field.hlc
        }
      }
    })
  })

  return maxHLC
}
