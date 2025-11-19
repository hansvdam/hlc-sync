import { useSimulatorStore } from './store/simulatorStore'
import NodeView from './components/NodeView'
import LogPanel from './components/LogPanel'
import MessageCanvas from './components/MessageCanvas'
import HelpOverlay from './components/HelpOverlay'

function App() {
  const resetSimulator = useSimulatorStore(state => state.resetSimulator)
  const messageDelay = useSimulatorStore(state => state.messageDelay)

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 p-4 flex justify-between items-center border-b border-gray-700">
        <h1 className="text-2xl font-bold">HLC Synchronization Simulator</h1>

        <div className="flex items-center gap-4">
          {/* Message delay control */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Message Delay:</label>
            <input
              type="range"
              min="500"
              max="5000"
              step="100"
              value={messageDelay}
              onChange={(e) => useSimulatorStore.setState({ messageDelay: parseInt(e.target.value) })}
              className="w-32"
            />
            <span className="text-sm text-gray-400 w-16">
              {(messageDelay / 1000).toFixed(1)}s
            </span>
          </div>

          <button
            onClick={resetSimulator}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Main content area with message visualization */}
      <div className="flex-1 relative overflow-hidden">
        {/* Three columns */}
        <div className="h-full grid grid-cols-3 gap-4 p-4">
          <NodeView nodeId="client-a" />
          <NodeView nodeId="server" />
          <NodeView nodeId="client-b" />
        </div>

        {/* Message canvas overlay */}
        <MessageCanvas />
      </div>

      {/* Log panel at bottom */}
      <LogPanel />

      {/* Help overlay */}
      <HelpOverlay />
    </div>
  )
}

export default App
