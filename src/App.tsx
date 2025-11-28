import { useState, useEffect } from 'react'
import { useSimulatorStore } from './store/simulatorStore'
import NodeView from './components/NodeView'
import LogPanel from './components/LogPanel'
import MessageCanvas from './components/MessageCanvas'
import HelpOverlay from './components/HelpOverlay'


function App() {
  const resetSimulator = useSimulatorStore(state => state.resetSimulator)
  const messageDelay = useSimulatorStore(state => state.messageDelay)
  const usePerTicketHLC = useSimulatorStore(state => state.usePerTicketHLC)
  const setUsePerTicketHLC = useSimulatorStore(state => state.setUsePerTicketHLC)
  const [logHeight, setLogHeight] = useState(192)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      const newHeight = window.innerHeight - e.clientY
      if (newHeight > 50 && newHeight < window.innerHeight - 100) {
        setLogHeight(newHeight)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = 'default'
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ns-resize'
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'default'
    }
  }, [isDragging])

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 py-2 px-4 flex justify-between items-center border-b border-gray-700 flex-shrink-0">
        <h1 className="text-xl font-bold">HLC Synchronization Simulator</h1>

        <div className="flex items-center gap-4">
          {/* HLC Mode Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">HLC Mode:</span>
            <button
              onClick={() => setUsePerTicketHLC(!usePerTicketHLC)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                usePerTicketHLC ? 'bg-purple-600' : 'bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  usePerTicketHLC ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-xs text-gray-400 w-20">
              {usePerTicketHLC ? 'Per-Ticket' : 'Per-Node'}
            </span>
          </div>

          {/* Message delay control */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Message Delay:</label>
            <input
              type="range"
              min="500"
              max="3000"
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
            className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Main content area with message visualization */}
      <div className="flex-1 relative overflow-hidden">
        {/* Message canvas overlay - fixed relative to view */}
        <div className="absolute inset-0 z-10 pointer-events-none">
          <MessageCanvas />
        </div>

        {/* Three columns - Scrollable Container */}
        <div className="h-full overflow-y-auto overflow-x-hidden">
          <div className="min-h-full grid grid-cols-3 gap-4 p-4 items-start">
            <NodeView nodeId="client-a" />
            <NodeView nodeId="server" />
            <NodeView nodeId="client-b" />
          </div>
        </div>
      </div>

      {/* Resizer */}
      <div 
        className="h-1 bg-gray-700 hover:bg-blue-500 cursor-ns-resize transition-colors z-10 flex-shrink-0"
        onMouseDown={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
      />

      {/* Log panel at bottom */}
      <div style={{ height: logHeight }} className="flex-shrink-0 relative">
        <LogPanel />
      </div>

      {/* Help overlay */}
      <HelpOverlay />
    </div>
  )
}

export default App
