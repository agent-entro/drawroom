// Landing page — hero section with Create Room / Join Room CTAs
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

export default function LandingPage() {
  const navigate = useNavigate();
  const [joinSlug, setJoinSlug] = useState('');
  const [joinError, setJoinError] = useState('');

  function handleCreateRoom() {
    // Phase 0: navigate to a placeholder; real API call in Phase 2
    navigate('/r/demo-room-001');
  }

  function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    const slug = joinSlug.trim();
    if (!slug) {
      setJoinError('Please enter a room code.');
      return;
    }
    setJoinError('');
    navigate(`/r/${slug}`);
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-50">
      <div className="max-w-2xl w-full text-center space-y-8">
        {/* Logo / Headline */}
        <div className="space-y-3">
          <h1 className="text-5xl font-extrabold text-gray-900 tracking-tight">
            Draw<span className="text-blue-600">Room</span>
          </h1>
          <p className="text-xl text-gray-600">
            Real-time collaborative drawing and chat. No sign-up required.
          </p>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={handleCreateRoom}
            className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-xl shadow hover:bg-blue-700 transition-colors focus:outline-none focus:ring-4 focus:ring-blue-300"
          >
            Create a Room
          </button>
        </div>

        {/* Join with code */}
        <form onSubmit={handleJoinRoom} className="flex flex-col sm:flex-row gap-3 justify-center">
          <div className="flex flex-col gap-1 flex-1 max-w-xs">
            <input
              type="text"
              placeholder="Room code (e.g. bright-owl-742)"
              value={joinSlug}
              onChange={(e) => setJoinSlug(e.target.value)}
              className="px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
              aria-label="Room code"
            />
            {joinError && <span className="text-sm text-red-500">{joinError}</span>}
          </div>
          <button
            type="submit"
            className="px-6 py-3 border-2 border-blue-600 text-blue-600 font-semibold rounded-xl hover:bg-blue-50 transition-colors focus:outline-none focus:ring-4 focus:ring-blue-200"
          >
            Join Room
          </button>
        </form>

        {/* Feature highlights */}
        <ul className="flex flex-wrap justify-center gap-6 text-sm text-gray-500">
          {['✏️ Live drawing', '💬 Integrated chat', '🔗 Instant share link', '⚡ No login needed'].map(
            (f) => (
              <li key={f}>{f}</li>
            ),
          )}
        </ul>
      </div>
    </main>
  );
}
