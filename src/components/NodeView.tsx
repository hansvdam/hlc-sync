import { useState } from 'react'
import type { NodeId, SyncMessage } from '../types'
import { useSimulatorStore } from '../store/simulatorStore'
import TicketTree from './TicketTree'
import { v4 as uuidv4 } from 'uuid'

interface NodeViewProps {
  nodeId: NodeId
}

export default function NodeView({ nodeId }: NodeViewProps) {
  const [showInbox, setShowInbox] = useState(false)
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)
  
  const node = useSimulatorStore(state => state.nodes[nodeId])
  const updateNodeTime = useSimulatorStore(state => state.updateNodeTime)
  const toggleDeviceOnline = useSimulatorStore(state => state.toggleDeviceOnline)
  const toggleAppOnline = useSimulatorStore(state => state.toggleAppOnline)
  const createTicket = useSimulatorStore(state => state.createTicket)
  const clearModifiedTickets = useSimulatorStore(state => state.clearModifiedTickets)
  const hasInFlightMessages = useSimulatorStore(state =>
    state.inFlightMessages.some(m => m.from === nodeId || m.to === nodeId)
  )

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeTime(nodeId, parseInt(e.target.value))
  }

  const toggleMessage = (messageId: string) => {
    setExpandedMessageId(expandedMessageId === messageId ? null : messageId)
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 flex flex-col border border-gray-700 h-full">
      {/* Header */}
      <div className="mb-4 flex-shrink-0">
        <h2 className="text-xl font-bold mb-2 capitalize flex items-center gap-2">
          {nodeId === 'server' ? 'Server' : nodeId.replace('-', ' ')}
          {hasInFlightMessages && (
            <span className="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
          )}
        </h2>

        {/* Controls */}
        <div className="space-y-2">
          {/* Time control */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Time:</label>
            <input
              type="number"
              value={node.currentTime}
              onChange={handleTimeChange}
              className="flex-1 bg-gray-700 px-2 py-1 rounded text-sm"
            />
          </div>

          {/* Online toggles (only for clients) */}
          {nodeId !== 'server' && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm">Device Online</span>
                <button
                  onClick={() => toggleDeviceOnline(nodeId)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    node.isOnline ? 'bg-green-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      node.isOnline ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">App Running</span>
                <button
                  onClick={() => toggleAppOnline(nodeId)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    node.isAppOnline ? 'bg-green-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      node.isAppOnline ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Status indicators */}
      <div className="mb-4 flex gap-2 flex-shrink-0">
        {nodeId !== 'server' && (
          <>
            <span className={`text-xs px-2 py-1 rounded ${
              node.isOnline ? 'bg-green-600' : 'bg-red-600'
            }`}>
              {node.isOnline ? 'Online' : 'Offline'}
            </span>
            <span className={`text-xs px-2 py-1 rounded ${
              node.isAppOnline ? 'bg-green-600' : 'bg-red-600'
            }`}>
              {node.isAppOnline ? 'Running' : 'Stopped'}
            </span>
          </>
        )}
      </div>

      {/* Inbox/Outbox */}
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs flex-shrink-0">
        <div 
          className={`bg-gray-700 p-2 rounded cursor-pointer hover:bg-gray-600 transition-colors ${showInbox ? 'ring-2 ring-blue-500' : ''}`}
          onClick={() => setShowInbox(!showInbox)}
        >
          <div className="font-bold mb-1 flex justify-between items-center">
            Inbox
            <span className={`transform transition-transform ${showInbox ? 'rotate-180' : ''}`}>▼</span>
          </div>
          <div className="text-gray-400">{node.inbox.length} messages</div>
        </div>
        <div className="bg-gray-700 p-2 rounded">
          <div className="font-bold mb-1">Outbox</div>
          <div className="text-gray-400">{node.outbox.length} messages</div>
        </div>
      </div>

      {/* Expanded Inbox View */}
      {showInbox && node.inbox.length > 0 && (
        <div className="mb-4 bg-gray-750 border border-gray-600 rounded p-2 max-h-60 overflow-y-auto">
          <div className="space-y-2">
            {node.inbox.map((msg) => (
              <div key={msg.id} className="bg-gray-700 rounded p-2 text-xs">
                <div 
                  className="flex justify-between items-center cursor-pointer"
                  onClick={() => toggleMessage(msg.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded uppercase text-[10px] font-bold ${
                      msg.type === 'push' ? 'bg-blue-900 text-blue-200' :
                      msg.type === 'pull' ? 'bg-purple-900 text-purple-200' :
                      'bg-green-900 text-green-200'
                    }`}>
                      {msg.type}
                    </span>
                    <span className="text-gray-300">from {msg.from}</span>
                  </div>
                  <span className="text-gray-400 text-[10px]">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                
                {expandedMessageId === msg.id && (
                  <div className="mt-2 pt-2 border-t border-gray-600">
                    <div className="font-semibold text-gray-400 mb-1">
                      Payload:
                    </div>
                    <pre className="text-[10px] bg-gray-900 p-2 rounded overflow-auto max-h-40 text-green-400 font-mono">
                      {JSON.stringify(msg, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Ticket button */}
      <div className="mb-4 flex-shrink-0">
        <button
          onClick={() => createTicket(nodeId)}
          className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm font-medium"
        >
          + Create Ticket
        </button>
      </div>

      {/* Sync buttons */}
      <div className="mb-4 space-y-2 flex-shrink-0">
        {nodeId !== 'server' ? (
          <>
            <button
              onClick={() => {
                // Create ticket deltas for modified fields only
                const ticketDeltas = node.modifiedTicketIds.map(ticketId => {
                  const ticket = node.tickets.find(t => t.id === ticketId)
                  if (!ticket) return null
                  
                  // Get modified fields for this ticket
                  const modifiedFieldNames = node.modifiedFields[ticketId] || []
                  
                  // Create partial fields object
                  const deltaFields: Record<string, any> = {}
                  modifiedFieldNames.forEach(fieldName => {
                    const field = ticket.fields[fieldName as keyof typeof ticket.fields]
                    if (field) {
                      deltaFields[fieldName] = field
                    }
                  })
                  
                  return {
                    id: ticketId,
                    fields: deltaFields
                  }
                }).filter(Boolean)
                
                const message = {
                  id: uuidv4(),
                  from: nodeId,
                  to: 'server' as NodeId,
                  type: 'push' as const,
                  tickets: ticketDeltas,
                  timestamp: Date.now()
                }
                useSimulatorStore.getState().sendMessage(message)
                clearModifiedTickets(nodeId)
              }}
              disabled={!node.isOnline || !node.isAppOnline || node.modifiedTicketIds.length === 0}
              className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm flex justify-between items-center"
            >
              <span>Push to Server</span>
              {node.modifiedTicketIds.length > 0 && (
                <span className="bg-blue-800 px-1.5 rounded text-xs">
                  {node.modifiedTicketIds.length}
                </span>
              )}
            </button>
            <button
              onClick={() => useSimulatorStore.getState().processInbox(nodeId)}
              disabled={node.inbox.length === 0}
              className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm"
            >
              Process Inbox ({node.inbox.length})
            </button>
          </>
        ) : (
          <button
            onClick={() => useSimulatorStore.getState().processInbox(nodeId)}
            disabled={node.inbox.length === 0}
            className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm"
          >
            Process Inbox ({node.inbox.length})
          </button>
        )}
      </div>

      {/* Ticket tree */}
      <div className="flex-1 overflow-auto min-h-0 border-t border-gray-700 pt-4">
        <TicketTree nodeId={nodeId} />
      </div>
    </div>
  )
}
