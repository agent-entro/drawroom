/**
 * EmojiPicker — lightweight emoji grid, no external library.
 * Shows ~80 common emojis in a scrollable popover.
 */
import { useEffect, useRef } from 'react';

const EMOJI_ROWS: string[][] = [
  ['😀','😂','😍','🥰','😎','🤔','😢','😡','🥳','🤩'],
  ['👍','👎','👏','🙌','🤝','🙏','💪','👀','❤️','💔'],
  ['🔥','✨','🎉','🎊','🎈','💯','⭐','🌟','💡','❓'],
  ['😅','😆','🤣','😇','🥺','😳','🤯','😴','🤗','😏'],
  ['🐶','🐱','🐸','🦊','🐼','🦁','🐺','🦄','🐙','🦋'],
  ['🍕','🍔','🌮','🍣','🍜','☕','🍺','🍓','🍎','🎂'],
  ['🚀','⚡','🌈','🎵','🎮','📱','💻','🔑','🏆','🎯'],
  ['👋','✌️','🤞','🤟','🖐️','👌','🤌','💎','🗣️','💬'],
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Emoji picker"
      className="absolute bottom-full mb-1 right-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-2 w-56 max-h-48 overflow-y-auto"
    >
      {EMOJI_ROWS.map((row, rowIdx) => (
        <div key={rowIdx} className="flex gap-0.5">
          {row.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Emoji ${emoji}`}
              onClick={() => { onSelect(emoji); onClose(); }}
              className="flex-1 text-lg leading-tight py-0.5 hover:bg-gray-100 rounded transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
