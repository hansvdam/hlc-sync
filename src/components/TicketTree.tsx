import { useState, useRef, useEffect } from 'react'
import type { NodeId } from '../types'
import { useSimulatorStore } from '../store/simulatorStore'
import { formatHLC } from '../utils/hlc'

interface TicketTreeProps {
  nodeId: NodeId
}

export default function TicketTree({ nodeId }: TicketTreeProps) {
  const tickets = useSimulatorStore(state => state.nodes[nodeId].tickets)
  const ticketHLCs = useSimulatorStore(state => state.nodes[nodeId].ticketHLCs)
  const highlightedFields = useSimulatorStore(state => state.nodes[nodeId].highlightedFields)
  const editTicketField = useSimulatorStore(state => state.editTicketField)
  const realTimeTyping = useSimulatorStore(state => state.realTimeTyping)
  const resetCounter = useSimulatorStore(state => state.resetCounter)
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set())
  const [editingField, setEditingField] = useState<{ticketId: string, field: string} | null>(null)
  // Track pending edits: map of "ticketId:fieldName" -> pending value
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  const toggleTicket = (ticketId: string) => {
    setExpandedTickets(prev => {
      const next = new Set(prev)
      if (next.has(ticketId)) {
        next.delete(ticketId)
      } else {
        next.add(ticketId)
      }
      return next
    })
  }

  // Track value changes, send immediately if real-time typing is enabled
  const handleValueChange = (ticketId: string, fieldName: string, value: string) => {
    const key = `${ticketId}:${fieldName}`
    setPendingEdits(prev => ({
      ...prev,
      [key]: value
    }))

    // In real-time mode, send immediately on each keystroke
    if (realTimeTyping) {
      editTicketField(nodeId, ticketId, fieldName, value)
    }
  }

  // Send the edit when clicking the send button
  const handleSendEdit = (ticketId: string, fieldName: string) => {
    const key = `${ticketId}:${fieldName}`
    const pendingValue = pendingEdits[key]
    if (pendingValue !== undefined) {
      editTicketField(nodeId, ticketId, fieldName, pendingValue)
      // Clear pending edit after sending
      setPendingEdits(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
    setEditingField(null)
  }

  // Cancel editing without sending
  const handleCancelEdit = (ticketId: string, fieldName: string) => {
    const key = `${ticketId}:${fieldName}`
    setPendingEdits(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setEditingField(null)
  }

  // Start editing a field
  const startEditing = (ticketId: string, fieldName: string, currentValue: string) => {
    const key = `${ticketId}:${fieldName}`
    setEditingField({ ticketId, field: fieldName })
    // Initialize pending value with current value
    setPendingEdits(prev => ({
      ...prev,
      [key]: currentValue
    }))
  }

  // Focus input when editing starts
  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingField])

  // Clear local state on simulator reset
  useEffect(() => {
    setExpandedTickets(new Set())
    setEditingField(null)
    setPendingEdits({})
  }, [resetCounter])

  // Check if a field has unsent changes
  const hasPendingEdit = (ticketId: string, fieldName: string, currentValue: string): boolean => {
    const key = `${ticketId}:${fieldName}`
    const pendingValue = pendingEdits[key]
    return pendingValue !== undefined && pendingValue !== currentValue
  }

  return (
    <div className="space-y-2">
      {tickets.map(ticket => (
        <div key={ticket.id} className="bg-gray-700 rounded">
          {/* Ticket header */}
          <div
            className="p-2 cursor-pointer hover:bg-gray-600 flex justify-between items-center"
            onClick={() => toggleTicket(ticket.id)}
          >
            <span className="font-mono text-sm">{ticket.id}</span>
            <span className="text-gray-400 text-xs">
              {expandedTickets.has(ticket.id) ? '▼' : '▶'}
            </span>
          </div>

          {/* Ticket fields (expanded) */}
          {expandedTickets.has(ticket.id) && (
            <div className="pb-2">
              {/* Ticket HLC display */}
              {ticketHLCs[ticket.id] && (
                <div className="px-4 py-1 text-xs text-purple-300 font-mono border-b border-gray-600 bg-purple-900/20">
                  Ticket HLC: {formatHLC(ticketHLCs[ticket.id])}
                </div>
              )}
              <div className="px-4 pt-2 space-y-2">
              {Object.entries(ticket.fields).map(([fieldName, field]) => {
                const highlightInfo = highlightedFields[`${ticket.id}:${fieldName}`]
                const isHighlighted = !!highlightInfo
                const isStale = highlightInfo?.isStale ?? false
                const isEditing = editingField?.ticketId === ticket.id && editingField?.field === fieldName
                const key = `${ticket.id}:${fieldName}`
                const pendingValue = pendingEdits[key]
                const hasPending = hasPendingEdit(ticket.id, fieldName, field.value)

                return (
                  <div
                    key={fieldName}
                    className={`text-sm p-1 rounded transition-colors duration-500 ${
                      isHighlighted
                        ? isStale
                          ? 'bg-orange-900/80 ring-1 ring-orange-500'  // Orange for stale
                          : 'bg-green-900/80 ring-1 ring-green-500'    // Green for normal
                        : ''
                    }`}
                  >
                    <div className="text-gray-400 mb-1">{fieldName}:</div>
                    <div className="flex gap-2 items-center">
                      {isEditing ? (
                        <>
                          <input
                            ref={inputRef}
                            type="text"
                            value={realTimeTyping ? field.value : (pendingValue ?? field.value)}
                            onChange={(e) => handleValueChange(ticket.id, fieldName, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (!realTimeTyping) {
                                  handleSendEdit(ticket.id, fieldName)
                                } else {
                                  handleCancelEdit(ticket.id, fieldName) // Clear pending and exit
                                }
                              } else if (e.key === 'Escape') {
                                handleCancelEdit(ticket.id, fieldName)
                              }
                            }}
                            className="flex-1 bg-gray-600 px-2 py-1 rounded"
                          />
                          {!realTimeTyping && (
                            <button
                              onClick={() => handleSendEdit(ticket.id, fieldName)}
                              className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium"
                              title="Send update"
                            >
                              Send
                            </button>
                          )}
                          <button
                            onClick={() => handleCancelEdit(ticket.id, fieldName)}
                            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs"
                            title={realTimeTyping ? "Done (Esc)" : "Cancel (Esc)"}
                          >
                            {realTimeTyping ? '✓' : '✕'}
                          </button>
                        </>
                      ) : (
                        <>
                          <div
                            className={`flex-1 px-2 py-1 rounded cursor-text hover:bg-gray-500 ${
                              hasPending && !realTimeTyping ? 'bg-yellow-900/50 ring-1 ring-yellow-500' : 'bg-gray-600'
                            }`}
                            onClick={() => startEditing(ticket.id, fieldName, field.value)}
                          >
                            {realTimeTyping ? field.value : (pendingValue ?? field.value)}
                          </div>
                          {hasPending && !realTimeTyping && (
                            <button
                              onClick={() => handleSendEdit(ticket.id, fieldName)}
                              className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium animate-pulse"
                              title="Send pending update"
                            >
                              Send
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 font-mono">
                      HLC: {formatHLC(field.hlc)}
                    </div>
                  </div>
                )
              })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
