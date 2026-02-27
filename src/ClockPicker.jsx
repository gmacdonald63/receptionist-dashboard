import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Clock } from 'lucide-react';

const SIZE = 240;
const CENTER = SIZE / 2;
const OUTER_R = CENTER - 26;
const HAND_R = CENTER - 36;

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function degToPos(deg, r) {
  const rad = (deg - 90) * (Math.PI / 180);
  return {
    x: CENTER + r * Math.cos(rad),
    y: CENTER + r * Math.sin(rad),
  };
}

function clickToAngle(cx, cy) {
  const deg = Math.atan2(cy - CENTER, cx - CENTER) * (180 / Math.PI) + 90;
  return (deg + 360) % 360;
}

function parse24(value) {
  if (!value) return { h12: 12, min: 0, ampm: 'AM' };
  const [h, m] = value.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { h12, min: m || 0, ampm };
}

function to24(h12, min, ampm) {
  let h = h12 % 12;
  if (ampm === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function displayTime(value) {
  if (!value) return null;
  const { h12, min, ampm } = parse24(value);
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

export default function ClockPicker({ value, onChange, label, required, placeholder = 'Select time' }) {
  const parsed = parse24(value);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('hour');
  const [h12, setH12] = useState(parsed.h12);
  const [min, setMin] = useState(parsed.min);
  const [ampm, setAmpm] = useState(parsed.ampm);
  const wrapperRef = useRef(null);
  const svgRef = useRef(null);

  // Sync internal state when value prop changes externally
  useEffect(() => {
    const p = parse24(value);
    setH12(p.h12);
    setMin(p.min);
    setAmpm(p.ampm);
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSvgClick = useCallback((e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (SIZE / rect.width);
    const cy = (e.clientY - rect.top) * (SIZE / rect.height);
    const angle = clickToAngle(cx, cy);
    const idx = Math.round(angle / 30) % 12;

    if (mode === 'hour') {
      const newH = HOURS[idx];
      setH12(newH);
      onChange(to24(newH, min, ampm));
      setMode('minute');
    } else {
      const newM = MINUTES[idx];
      setMin(newM);
      onChange(to24(h12, newM, ampm));
      setOpen(false);
    }
  }, [mode, h12, min, ampm, onChange]);

  const handleAmPm = (ap) => {
    setAmpm(ap);
    if (value) onChange(to24(h12, min, ap));
  };

  // Hand angle: continuous for minutes so it tracks the actual value
  const handAngle = mode === 'hour'
    ? (HOURS.indexOf(h12) >= 0 ? HOURS.indexOf(h12) : 0) * 30
    : (min / 60) * 360;

  const handTip = degToPos(handAngle, HAND_R);

  return (
    <div ref={wrapperRef} className="relative">
      {label && (
        <label className="block text-gray-400 text-sm mb-1">
          {label}{required && <span className="text-red-400"> *</span>}
        </label>
      )}
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setMode('hour'); }}
        className="w-full px-3 py-2 bg-[#2d3748] border border-gray-600 rounded-lg text-sm focus:outline-none focus:border-blue-500 flex items-center justify-between"
      >
        <span className={value ? 'text-white' : 'text-gray-500'}>
          {displayTime(value) || placeholder}
        </span>
        <Clock className="w-4 h-4 text-gray-400" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-4 z-[60]">

          {/* Time display + AM/PM */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-baseline gap-0.5">
              <button
                type="button"
                onClick={() => setMode('hour')}
                className={`text-3xl font-bold leading-none px-1 rounded ${mode === 'hour' ? 'text-blue-400 bg-gray-700' : 'text-white hover:bg-gray-700'}`}
              >
                {String(h12).padStart(2, '0')}
              </button>
              <span className="text-3xl font-bold text-gray-400">:</span>
              <button
                type="button"
                onClick={() => setMode('minute')}
                className={`text-3xl font-bold leading-none px-1 rounded ${mode === 'minute' ? 'text-blue-400 bg-gray-700' : 'text-white hover:bg-gray-700'}`}
              >
                {String(min).padStart(2, '0')}
              </button>
            </div>
            <div className="flex flex-col gap-1 ml-3">
              {['AM', 'PM'].map(ap => (
                <button
                  key={ap}
                  type="button"
                  onClick={() => handleAmPm(ap)}
                  className={`px-2.5 py-0.5 rounded text-xs font-semibold transition-colors ${ampm === ap ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white border border-gray-600'}`}
                >
                  {ap}
                </button>
              ))}
            </div>
          </div>

          <p className="text-gray-500 text-xs text-center mb-2">
            {mode === 'hour' ? 'Tap to select hour' : 'Tap to select minute'}
          </p>

          {/* Clock face */}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="w-full max-w-[210px] mx-auto block cursor-pointer select-none"
            onClick={handleSvgClick}
          >
            {/* Face */}
            <circle cx={CENTER} cy={CENTER} r={CENTER - 2} fill="#111827" stroke="#374151" strokeWidth="1.5" />

            {/* Numbers */}
            {(mode === 'hour' ? HOURS : MINUTES).map((val, i) => {
              const pos = degToPos(i * 30, OUTER_R);
              const isSelected = mode === 'hour' ? val === h12 : val === min;
              return (
                <g key={val}>
                  {isSelected && (
                    <circle cx={pos.x} cy={pos.y} r="15" fill="#2563eb" />
                  )}
                  <text
                    x={pos.x}
                    y={pos.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={isSelected ? '#ffffff' : '#9ca3af'}
                    fontSize={mode === 'hour' ? '14' : '11'}
                    fontWeight={isSelected ? '600' : '400'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {mode === 'hour' ? val : String(val).padStart(2, '0')}
                  </text>
                </g>
              );
            })}

            {/* Clock hand */}
            <line
              x1={CENTER}
              y1={CENTER}
              x2={handTip.x}
              y2={handTip.y}
              stroke="#3b82f6"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* Center dot */}
            <circle cx={CENTER} cy={CENTER} r="4" fill="#3b82f6" />
          </svg>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
