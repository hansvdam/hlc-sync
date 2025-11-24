import { useEffect, useRef } from 'react'
import { useSimulatorStore } from '../store/simulatorStore'

export default function LogPanel() {
  const logs = useSimulatorStore(state => state.logs)
  const logEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="h-full bg-gray-800 border-t border-gray-700 flex flex-col">
      <div className="px-4 py-2 bg-gray-900 font-bold text-sm">Operation Log</div>
      <div className="flex-1 overflow-auto px-4 py-2 font-mono text-xs space-y-1">
        {logs.map((log, index) => (
          <div key={index} className="flex gap-4 whitespace-nowrap">
            <span className="text-gray-500">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span className={`font-bold ${
              log.nodeId === 'client-a' ? 'text-blue-400' :
              log.nodeId === 'client-b' ? 'text-green-400' :
              'text-purple-400'
            }`}>
              [{log.nodeId}]
            </span>
            <span className="text-gray-300">{log.action}:</span>
            <span className="text-gray-400">{log.details}</span>
            {log.data && (
              <span className="text-gray-500 ml-2">
                {JSON.stringify(log.data)}
              </span>
            )}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  )
}
