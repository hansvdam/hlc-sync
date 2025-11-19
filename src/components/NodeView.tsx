import type { NodeId } from '../types'
import { useSimulatorStore } from '../store/simulatorStore'
import TicketTree from './TicketTree'
import { v4 as uuidv4 } from 'uuid'

interface NodeViewProps {
  nodeId: NodeId
}

export default function NodeView({ nodeId }: NodeViewProps) {
  const node = useSimulatorStore(state => state.nodes[nodeId])
  const updateNodeTime = useSimulatorStore(state => state.updateNodeTime)
  const toggleDeviceOnline = useSimulatorStore(state => state.toggleDeviceOnline)
  const toggleAppOnline = useSimulatorStore(state => state.toggleAppOnline)
  const createTicket = useSimulatorStore(state => state.createTicket)
  const hasInFlightMessages = useSimulatorStore(state =>
    state.inFlightMessages.some(m => m.from === nodeId || m.to === nodeId)
  )

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeTime(nodeId, parseInt(e.target.value))
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 flex flex-col border border-gray-700">
      {/* Header */}
      <div className="mb-4">
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
      <div className="mb-4 flex gap-2">
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
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-700 p-2 rounded">
          <div className="font-bold mb-1">Inbox</div>
          <div className="text-gray-400">{node.inbox.length} messages</div>
        </div>
        <div className="bg-gray-700 p-2 rounded">
          <div className="font-bold mb-1">Outbox</div>
          <div className="text-gray-400">{node.outbox.length} messages</div>
        </div>
      </div>

      {/* Create Ticket button */}
      <div className="mb-4">
        <button
          onClick={() => createTicket(nodeId)}
          className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm font-medium"
        >
          + Create Ticket
        </button>
      </div>

      {/* Sync buttons */}
      <div className="mb-4 space-y-2">
        {nodeId !== 'server' ? (
          <>
            <button
              onClick={() => {
                const message = {
                  id: uuidv4(),
                  from: nodeId,
                  to: 'server' as NodeId,
                  type: 'push' as const,
                  tickets: node.tickets,
                  timestamp: Date.now()
                }
                useSimulatorStore.getState().sendMessage(message)
              }}
              disabled={!node.isOnline || !node.isAppOnline}
              className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm"
            >
              Push to Server
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
      <div className="flex-1 overflow-auto">
        <TicketTree nodeId={nodeId} />
      </div>
    </div>
  )
}
