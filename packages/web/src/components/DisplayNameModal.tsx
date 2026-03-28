// Modal overlay prompting the user to enter a display name before joining a room
import { useState } from 'react';
import { getUserName } from '../lib/user.ts';

interface DisplayNameModalProps {
  onJoin: (name: string) => Promise<void>;
  error?: string | null;
  isLoading?: boolean;
}

export default function DisplayNameModal({ onJoin, error, isLoading }: DisplayNameModalProps) {
  const [name, setName] = useState('');
  const placeholder = getUserName();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim() || placeholder;
    await onJoin(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4 space-y-6">
        <div className="space-y-1 text-center">
          <h2 className="text-2xl font-bold text-gray-900">Join Room</h2>
          <p className="text-sm text-gray-500">Choose a display name to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="display-name" className="block text-sm font-medium text-gray-700">
              Display name
            </label>
            <input
              id="display-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 30))}
              placeholder={placeholder}
              maxLength={30}
              disabled={isLoading}
              autoFocus
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors focus:outline-none focus:ring-4 focus:ring-blue-300 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Joining…' : 'Join Room'}
          </button>
        </form>
      </div>
    </div>
  );
}
