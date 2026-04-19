import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

function formatTime12(hhmm) {
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${period}`;
}

const TIME_SLOTS = (() => {
  const slots = [];
  for (let i = 0; i < 24 * 60; i += 15) {
    const h = Math.floor(i / 60);
    const m = i % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return slots;
})();

export default function TimePickerDropdown({ value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const selectedRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Scroll selected item into view when dropdown opens
  useEffect(() => {
    if (isOpen && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'center' });
    }
  }, [isOpen]);

  function handleSelect(time) {
    onChange(time);
    setIsOpen(false);
  }

  function handleKeyDown(e) {
    if (!isOpen) return;
    if (e.key === 'Escape') { setIsOpen(false); return; }
    const idx = TIME_SLOTS.indexOf(value);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(TIME_SLOTS[Math.min(idx + 1, TIME_SLOTS.length - 1)]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(TIME_SLOTS[Math.max(idx - 1, 0)]);
    } else if (e.key === 'Enter') {
      setIsOpen(false);
    }
  }

  const displayTime = value ? formatTime12(value) : 'Select time';

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/15 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/25 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {displayTime}
        <ChevronDown size={11} className={`transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          ref={listRef}
          className="absolute top-full left-0 mt-1 w-32 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-50 overflow-y-auto"
          style={{ maxHeight: '220px' }}
        >
          {TIME_SLOTS.map(time => {
            const isSelected = time === value;
            return (
              <button
                key={time}
                ref={isSelected ? selectedRef : null}
                type="button"
                onClick={() => handleSelect(time)}
                className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                  isSelected
                    ? 'bg-blue-600 text-white font-medium'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {formatTime12(time)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
