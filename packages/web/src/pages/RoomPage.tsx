// Room page — placeholder layout; real canvas + chat wired up in Phase 1–3
import { useParams } from 'react-router-dom';

export default function RoomPage() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white shadow-sm">
        <span className="font-bold text-gray-900 text-lg">
          Draw<span className="text-blue-600">Room</span>
        </span>
        <span className="text-sm text-gray-500 font-mono">{slug}</span>
        <button className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors">
          Share
        </button>
      </header>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas placeholder */}
        <section
          className="flex-1 flex items-center justify-center bg-gray-50 border-r border-gray-200"
          aria-label="Drawing canvas"
        >
          <p className="text-gray-400 text-lg">Canvas coming in Phase 1</p>
        </section>

        {/* Chat placeholder */}
        <aside className="w-72 flex flex-col bg-white" aria-label="Chat panel">
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-400 text-sm">Chat coming in Phase 3</p>
          </div>
          <div className="border-t border-gray-200 p-3">
            <input
              disabled
              placeholder="Type a message..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-400 text-sm"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
