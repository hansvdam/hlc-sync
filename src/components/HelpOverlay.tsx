import { useState } from 'react'

export default function HelpOverlay() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 w-12 h-12 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center text-2xl z-10"
        title="Help"
      >
        ?
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="bg-gray-800 rounded-lg p-6 max-w-2xl max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold mb-4">HLC Sync Simulator Help</h2>

            <section className="mb-4">
              <h3 className="text-lg font-bold mb-2">What is HLC?</h3>
              <p className="text-gray-300 text-sm">
                Hybrid Logical Clock combines physical time with logical counters to create
                causally-ordered timestamps in distributed systems. Each timestamp has three parts:
                physical time, counter, and node ID.
              </p>
            </section>

            <section className="mb-4">
              <h3 className="text-lg font-bold mb-2">How to Use</h3>
              <ul className="text-gray-300 text-sm space-y-2 list-disc pl-4">
                <li>Click on tickets to expand and view fields</li>
                <li>Click on field values to edit them inline</li>
                <li>Adjust node time to simulate clock skew</li>
                <li>Toggle online/offline to simulate network conditions</li>
                <li>Push changes to server to sync</li>
                <li>Watch messages animate between nodes</li>
                <li>Process inbox to merge changes</li>
                <li>View conflict resolution in the log</li>
              </ul>
            </section>

            <section className="mb-4">
              <h3 className="text-lg font-bold mb-2">Conflict Resolution</h3>
              <p className="text-gray-300 text-sm">
                When the same field is edited on different nodes, HLC determines the winner:
                Higher timestamp wins, then higher counter, then node ID alphabetically.
              </p>
            </section>

            <button
              onClick={() => setIsOpen(false)}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}
