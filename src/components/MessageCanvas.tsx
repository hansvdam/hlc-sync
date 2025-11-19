import { useEffect, useRef } from 'react'
import { useSimulatorStore } from '../store/simulatorStore'

export default function MessageCanvas() {
  const inFlightMessages = useSimulatorStore(state => state.inFlightMessages)
  const updateMessageProgress = useSimulatorStore(state => state.updateMessageProgress)
  const deliverMessage = useSimulatorStore(state => state.deliverMessage)
  const messageDelay = useSimulatorStore(state => state.messageDelay)
  const animationFrameRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    let lastTime = Date.now()

    const animate = () => {
      const now = Date.now()
      const delta = now - lastTime
      lastTime = now

      // Update progress for all in-flight messages
      inFlightMessages.forEach(message => {
        const progressIncrement = delta / messageDelay
        const newProgress = Math.min(1, message.progress + progressIncrement)

        if (newProgress >= 1) {
          // Deliver the message
          deliverMessage(message.id)
        } else {
          // Update progress
          updateMessageProgress(message.id, newProgress)
        }
      })

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [inFlightMessages, messageDelay, updateMessageProgress, deliverMessage])

  // Calculate positions for nodes (assuming three-column grid)
  const getNodePosition = (nodeId: string): { x: number, y: number } => {
    const width = window.innerWidth
    const height = window.innerHeight - 48 - 192 // Subtract header and log panel

    const positions = {
      'client-a': { x: width * 0.16, y: height * 0.5 },
      'server': { x: width * 0.5, y: height * 0.5 },
      'client-b': { x: width * 0.83, y: height * 0.5 }
    }

    return positions[nodeId as keyof typeof positions] || { x: 0, y: 0 }
  }

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ top: '64px', height: 'calc(100% - 64px - 192px)' }}
    >
      {inFlightMessages.map(message => {
        const from = getNodePosition(message.from)
        const to = getNodePosition(message.to)

        // Interpolate position based on progress
        const x = from.x + (to.x - from.x) * message.progress
        const y = from.y + (to.y - from.y) * message.progress

        return (
          <g key={message.id}>
            {/* Path line */}
            <line
              x1={from.x}
              y1={from.y}
              x2={x}
              y2={y}
              stroke="#60a5fa"
              strokeWidth="2"
              strokeDasharray="5,5"
              opacity="0.6"
            />

            {/* Moving message indicator */}
            <g transform={`translate(${x}, ${y})`}>
              <circle
                r="8"
                fill="#60a5fa"
                className="animate-pulse"
              />
              <text
                y="4"
                textAnchor="middle"
                fontSize="10"
                fill="white"
                fontWeight="bold"
              >
                {message.type[0].toUpperCase()}
              </text>
            </g>

            {/* Message info tooltip */}
            {message.progress > 0.3 && message.progress < 0.7 && (
              <g transform={`translate(${x}, ${y - 20})`}>
                <rect
                  x="-40"
                  y="-15"
                  width="80"
                  height="20"
                  fill="#1f2937"
                  stroke="#60a5fa"
                  strokeWidth="1"
                  rx="4"
                />
                <text
                  textAnchor="middle"
                  y="0"
                  fontSize="10"
                  fill="white"
                >
                  {message.type === 'update' 
                    ? '1 update' 
                    : `${message.tickets.length} ticket${message.tickets.length !== 1 ? 's' : ''}`
                  }
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
