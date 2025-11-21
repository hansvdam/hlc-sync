import { useState } from 'react'
import type { NodeId } from '../types'
import { useSimulatorStore } from '../store/simulatorStore'
import { formatHLC } from '../utils/hlc'

interface TicketTreeProps {
  nodeId: NodeId
}

export default function TicketTree({ nodeId }: TicketTreeProps) {
  const tickets = useSimulatorStore(state => state.nodes[nodeId].tickets)
  const highlightedFields = useSimulatorStore(state => state.nodes[nodeId].highlightedFields)
  const editTicketField = useSimulatorStore(state => state.editTicketField)
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set())
  const [editingField, setEditingField] = useState<{ticketId: string, field: string} | null>(null)

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

  const handleFieldEdit = (ticketId: string, fieldName: string, value: string) => {
    editTicketField(nodeId, ticketId, fieldName, value)
    setEditingField(null)
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
            <div className="px-4 pb-2 space-y-2">
              {Object.entries(ticket.fields).map(([fieldName, field]) => {
                const isHighlighted = highlightedFields[`${ticket.id}:${fieldName}`]
                
                return (
                  <div 
                    key={fieldName} 
                    className={`text-sm p-1 rounded transition-colors duration-500 ${
                      isHighlighted ? 'bg-green-900/80 ring-1 ring-green-500' : ''
                    }`}
                  >
                    <div className="text-gray-400 mb-1">{fieldName}:</div>
                    {editingField?.ticketId === ticket.id && editingField?.field === fieldName ? (
                      <input
                        type="text"
                        defaultValue={field.value}
                        onBlur={(e) => handleFieldEdit(ticket.id, fieldName, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleFieldEdit(ticket.id, fieldName, e.currentTarget.value)
                          }
                        }}
                        autoFocus
                        className="w-full bg-gray-600 px-2 py-1 rounded"
                      />
                    ) : (
                      <div
                        className="bg-gray-600 px-2 py-1 rounded cursor-text hover:bg-gray-500"
                        onClick={() => setEditingField({ ticketId: ticket.id, field: fieldName })}
                      >
                        {field.value}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 mt-1 font-mono">
                      HLC: {formatHLC(field.hlc)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
