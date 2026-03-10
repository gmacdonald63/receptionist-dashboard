import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight, Calendar, Plus } from 'lucide-react';
import AppointmentSidePanel from './AppointmentSidePanel';

// ─── Utility functions ──────────────────────────────────────────────────────────

function toMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function fromMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatTime12(hhmm) {
  if (!hhmm) return '';
  const [hours, minutes] = hhmm.split(':');
  const hour = parseInt(hours, 10);
  if (isNaN(hour)) return hhmm;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

function getWeekDates(weekStart) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    dates.push(date);
  }
  return dates;
}

function formatDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateForDisplay(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDayName(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const SLOT_HEIGHT = 40; // px per 30-min slot
const DEFAULT_OPEN = '07:00';
const DEFAULT_CLOSE = '18:00';

// ─── Component ──────────────────────────────────────────────────────────────────

const AppointmentCalendar = ({
  appointments,
  businessHours,
  technicians,
  currentWeekStart,
  onWeekChange,
  onSaveAppointment,
  onRefresh,
  loading,
  clientId,
}) => {
  // Internal state
  const [sidePanelMode, setSidePanelMode] = useState(null); // null | 'add' | 'view'
  const [selectedSlot, setSelectedSlot] = useState(null); // { date, time }
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [previewDuration, setPreviewDuration] = useState(60);
  const [mobileSelectedDay, setMobileSelectedDay] = useState(() => new Date());

  const scrollContainerRef = useRef(null);

  const weekDates = useMemo(() => getWeekDates(currentWeekStart), [currentWeekStart]);

  const todayStr = useMemo(() => formatDateStr(new Date()), []);

  const isCurrentWeek = useMemo(() => {
    const today = new Date();
    const todaySunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    return formatDateStr(todaySunday) === formatDateStr(currentWeekStart);
  }, [currentWeekStart]);

  // ─── Grid time range calculation ────────────────────────────────────────────

  const { gridStartTime, gridEndTime, timeSlots } = useMemo(() => {
    let earliestOpen = null;
    let latestClose = null;

    if (businessHours && businessHours.length > 0) {
      for (const bh of businessHours) {
        if (!bh.is_open) continue;
        const openMin = toMinutes(bh.open_time);
        const closeMin = toMinutes(bh.close_time);
        if (earliestOpen === null || openMin < earliestOpen) earliestOpen = openMin;
        if (latestClose === null || closeMin > latestClose) latestClose = closeMin;
      }
    }

    // Fallback if no business hours defined or all days closed
    if (earliestOpen === null) earliestOpen = toMinutes(DEFAULT_OPEN);
    if (latestClose === null) latestClose = toMinutes(DEFAULT_CLOSE);

    // Subtract/add 1 hour for pre/post buffer
    const start = Math.max(0, earliestOpen - 60);
    const end = Math.min(24 * 60, latestClose + 60);

    const startStr = fromMinutes(start);
    const endStr = fromMinutes(end);

    // Generate 30-minute slots
    const slots = [];
    for (let m = start; m < end; m += 30) {
      slots.push(fromMinutes(m));
    }

    return { gridStartTime: startStr, gridEndTime: endStr, timeSlots: slots };
  }, [businessHours]);

  const gridStartMin = useMemo(() => toMinutes(gridStartTime), [gridStartTime]);

  // ─── Business hours lookup for each day ─────────────────────────────────────

  const getBusinessHoursForDay = useCallback(
    (dayOfWeek) => {
      if (!businessHours || businessHours.length === 0) return null;
      return businessHours.find((bh) => bh.day_of_week === dayOfWeek) || null;
    },
    [businessHours]
  );

  const isDayClosed = useCallback(
    (dayOfWeek) => {
      const bh = getBusinessHoursForDay(dayOfWeek);
      return bh ? !bh.is_open : false;
    },
    [getBusinessHoursForDay]
  );

  const isSlotInBusinessHours = useCallback(
    (dayOfWeek, slotTime) => {
      const bh = getBusinessHoursForDay(dayOfWeek);
      if (!bh || !bh.is_open) return false;
      const slotMin = toMinutes(slotTime);
      const openMin = toMinutes(bh.open_time);
      const closeMin = toMinutes(bh.close_time);
      return slotMin >= openMin && slotMin < closeMin;
    },
    [getBusinessHoursForDay]
  );

  // ─── Appointments grouped by date ───────────────────────────────────────────

  const appointmentsByDate = useMemo(() => {
    const map = {};
    if (!appointments) return map;
    for (const apt of appointments) {
      if (!apt.date) continue;
      if (!map[apt.date]) map[apt.date] = [];
      map[apt.date].push(apt);
    }
    return map;
  }, [appointments]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSlotClick = useCallback((dateStr, timeStr) => {
    setSelectedSlot({ date: dateStr, time: timeStr });
    setSelectedAppointment(null);
    setSidePanelMode('add');
    setPreviewDuration(60);
  }, []);

  const handleAppointmentClick = useCallback((apt) => {
    setSelectedAppointment(apt);
    setSelectedSlot(null);
    setSidePanelMode('view');
  }, []);

  const handleSave = useCallback(
    async (formData) => {
      await onSaveAppointment(formData);
      setSidePanelMode(null);
      setSelectedSlot(null);
    },
    [onSaveAppointment]
  );

  const handleCloseSidePanel = useCallback(() => {
    setSidePanelMode(null);
    setSelectedSlot(null);
    setSelectedAppointment(null);
  }, []);

  const handlePreviewDurationChange = useCallback((mins) => {
    setPreviewDuration(mins);
  }, []);

  const goToToday = useCallback(() => {
    const today = new Date();
    const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    onWeekChange(sunday);
  }, [onWeekChange]);

  const goPreviousWeek = useCallback(() => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() - 7);
    onWeekChange(newDate);
  }, [currentWeekStart, onWeekChange]);

  const goNextWeek = useCallback(() => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() + 7);
    onWeekChange(newDate);
  }, [currentWeekStart, onWeekChange]);

  // ─── Auto-scroll to current time on mount ───────────────────────────────────

  useEffect(() => {
    if (!scrollContainerRef.current) return;
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const scrollTarget = ((currentMin - gridStartMin) / 30) * SLOT_HEIGHT;
    // Offset by ~200px so current time isn't at the very top
    const scrollPos = Math.max(0, scrollTarget - 200);
    scrollContainerRef.current.scrollTop = scrollPos;
  }, [gridStartMin]);

  // ─── Mobile day selection ───────────────────────────────────────────────────

  const mobileSelectedDateStr = useMemo(() => formatDateStr(mobileSelectedDay), [mobileSelectedDay]);

  // Sync mobile selected day when week changes
  useEffect(() => {
    const newWeekDates = getWeekDates(currentWeekStart);
    const currentMobileStr = formatDateStr(mobileSelectedDay);
    const inWeek = newWeekDates.some((d) => formatDateStr(d) === currentMobileStr);
    if (!inWeek) {
      // Default to today if in current week, else first day
      const today = new Date();
      const todayInWeek = newWeekDates.some((d) => formatDateStr(d) === formatDateStr(today));
      setMobileSelectedDay(todayInWeek ? today : newWeekDates[0]);
    }
  }, [currentWeekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const renderAppointmentBlock = (apt, dayOfWeek, dateStr) => {
    const startMin = toMinutes(apt.start_time);
    const endMin =
      apt.end_time && apt.end_time !== apt.start_time
        ? toMinutes(apt.end_time)
        : startMin + 60;

    const top = ((startMin - gridStartMin) / 30) * SLOT_HEIGHT;
    const height = Math.max(((endMin - startMin) / 30) * SLOT_HEIGHT, 24);

    const tech = technicians ? technicians.find((t) => t.id === apt.technician_id) : null;

    const blockStyle = {
      position: 'absolute',
      top: `${top}px`,
      height: `${height}px`,
      left: '2px',
      right: '2px',
      zIndex: 10,
    };

    if (tech && tech.color) {
      blockStyle.borderLeft = `4px solid ${tech.color}`;
      blockStyle.backgroundColor = `${tech.color}20`;
    }

    const isSelected = selectedAppointment && selectedAppointment.id === apt.id;

    return (
      <div
        key={apt.id}
        className={`rounded-r-md cursor-pointer transition-all overflow-hidden px-1.5 py-0.5 ${
          !tech ? 'border-l-4 border-gray-500 bg-gray-600/20' : ''
        } ${isSelected ? 'ring-2 ring-blue-400 brightness-125' : 'hover:brightness-125'}`}
        style={blockStyle}
        onClick={(e) => {
          e.stopPropagation();
          handleAppointmentClick(apt);
        }}
        title={`${apt.name || 'Appointment'} - ${formatTime12(apt.start_time)}${apt.end_time ? ' to ' + formatTime12(apt.end_time) : ''}`}
      >
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-white text-[11px] font-medium truncate leading-tight">
            {apt.name || 'Appointment'}
          </span>
          {apt.source === 'ai' || apt.source === 'call' ? (
            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400" title="AI booked" />
          ) : (
            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-400" title="Manual" />
          )}
        </div>
        {height >= 60 && (
          <p className="text-gray-300 text-[10px] leading-tight mt-0.5">
            {formatTime12(apt.start_time)}
            {apt.end_time ? ` - ${formatTime12(apt.end_time)}` : ''}
          </p>
        )}
        {height >= 80 && apt.address && (
          <p className="text-gray-400 text-[10px] leading-tight mt-0.5 truncate">
            {apt.address}
          </p>
        )}
      </div>
    );
  };

  const renderPreviewBlock = (dateStr) => {
    if (sidePanelMode !== 'add' || !selectedSlot || selectedSlot.date !== dateStr) return null;

    const startMin = toMinutes(selectedSlot.time);
    const top = ((startMin - gridStartMin) / 30) * SLOT_HEIGHT;
    const height = Math.max((previewDuration / 30) * SLOT_HEIGHT, 24);

    return (
      <div
        key="preview-block"
        className="absolute left-0.5 right-0.5 border-2 border-dashed border-blue-400 bg-blue-600/10 rounded-r-md px-1.5 py-0.5 pointer-events-none"
        style={{
          top: `${top}px`,
          height: `${height}px`,
          zIndex: 5,
        }}
      >
        <span className="text-blue-300 text-[11px] font-medium">New appointment</span>
        <p className="text-blue-400/70 text-[10px] leading-tight mt-0.5">
          {formatTime12(selectedSlot.time)} ({previewDuration}min)
        </p>
      </div>
    );
  };

  const renderDayColumn = (date, dayIndex) => {
    const dateStr = formatDateStr(date);
    const dayOfWeek = date.getDay();
    const isToday = dateStr === todayStr;
    const closed = isDayClosed(dayOfWeek);
    const dayAppointments = appointmentsByDate[dateStr] || [];

    return (
      <div key={dateStr} className="relative" style={{ minWidth: 0 }}>
        {/* Background slot cells */}
        {timeSlots.map((slotTime) => {
          const inBiz = isSlotInBusinessHours(dayOfWeek, slotTime);
          const slotClickable = !closed;

          return (
            <div
              key={slotTime}
              className={`border-b border-r ${
                closed
                  ? 'bg-gray-900/50 border-gray-700/10 cursor-not-allowed'
                  : inBiz
                  ? 'bg-gray-800/50 border-gray-700/20 hover:bg-blue-900/20 cursor-pointer'
                  : 'bg-gray-900/30 border-gray-700/10 hover:bg-blue-900/10 cursor-pointer'
              } ${dayIndex === 6 ? 'border-r-0' : 'border-gray-700/20'}`}
              style={{ height: `${SLOT_HEIGHT}px` }}
              onClick={slotClickable ? () => handleSlotClick(dateStr, slotTime) : undefined}
            />
          );
        })}

        {/* Appointment blocks (absolute positioned) */}
        {dayAppointments.map((apt) => renderAppointmentBlock(apt, dayOfWeek, dateStr))}

        {/* Preview block */}
        {renderPreviewBlock(dateStr)}
      </div>
    );
  };

  // ─── Desktop Grid ───────────────────────────────────────────────────────────

  const renderDesktopGrid = () => (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-auto border border-gray-700 rounded-lg bg-gray-900"
    >
      <div
        className="grid min-w-0"
        style={{
          gridTemplateColumns: '60px repeat(7, 1fr)',
        }}
      >
        {/* Header row */}
        <div className="sticky top-0 z-20 bg-gray-900 border-b border-gray-700" />
        {weekDates.map((date) => {
          const isToday = formatDateStr(date) === todayStr;
          const closed = isDayClosed(date.getDay());
          return (
            <div
              key={formatDateStr(date)}
              className={`sticky top-0 z-20 bg-gray-900 border-b border-gray-700 px-2 py-2 text-center ${
                closed ? 'opacity-40' : ''
              }`}
            >
              <p className={`text-xs font-medium ${closed ? 'text-gray-600' : 'text-gray-400'}`}>
                {formatDayName(date)}
              </p>
              <div className="flex items-center justify-center gap-1">
                <p className={`text-sm font-semibold ${isToday ? 'text-blue-400' : 'text-white'}`}>
                  {date.getDate()}
                </p>
                {isToday && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
              </div>
            </div>
          );
        })}

        {/* Time labels column + day columns (rendered per row for the time label, but days are separate) */}
      </div>

      {/* Scrollable body grid */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: '60px repeat(7, 1fr)',
        }}
      >
        {/* Time labels */}
        <div>
          {timeSlots.map((slotTime, idx) => (
            <div
              key={slotTime}
              className="border-b border-gray-700/20 pr-2 text-right flex items-start justify-end"
              style={{ height: `${SLOT_HEIGHT}px` }}
            >
              {idx % 2 === 0 && (
                <span className="text-gray-500 text-[10px] leading-none mt-1">
                  {formatTime12(slotTime)}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDates.map((date, dayIndex) => renderDayColumn(date, dayIndex))}
      </div>
    </div>
  );

  // ─── Mobile Grid (single day) ──────────────────────────────────────────────

  const renderMobileDayPicker = () => (
    <div className="flex gap-1.5 overflow-x-auto pb-2 px-1 -mx-1 scrollbar-hide">
      {weekDates.map((date) => {
        const dateStr = formatDateStr(date);
        const isToday = dateStr === todayStr;
        const isSelected = dateStr === mobileSelectedDateStr;
        const closed = isDayClosed(date.getDay());

        return (
          <button
            key={dateStr}
            onClick={() => setMobileSelectedDay(date)}
            className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl transition-colors ${
              isSelected
                ? 'bg-blue-600 text-white'
                : isToday
                ? 'bg-blue-900/30 text-blue-400 border border-blue-500/40'
                : closed
                ? 'bg-gray-800/50 text-gray-600'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-750'
            }`}
          >
            <span className="text-[10px] font-medium uppercase">{formatDayName(date)}</span>
            <span className="text-sm font-semibold">{date.getDate()}</span>
          </button>
        );
      })}
    </div>
  );

  const renderMobileGrid = () => {
    const mobileDate = mobileSelectedDay;
    const dateStr = formatDateStr(mobileDate);
    const dayOfWeek = mobileDate.getDay();
    const closed = isDayClosed(dayOfWeek);
    const dayAppointments = appointmentsByDate[dateStr] || [];

    return (
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto border border-gray-700 rounded-lg bg-gray-900"
      >
        <div className="relative" style={{ minWidth: 0 }}>
          {/* Time slots */}
          {timeSlots.map((slotTime, idx) => {
            const inBiz = isSlotInBusinessHours(dayOfWeek, slotTime);
            const slotClickable = !closed;

            return (
              <div
                key={slotTime}
                className={`flex border-b ${
                  closed
                    ? 'bg-gray-900/50 border-gray-700/10 cursor-not-allowed'
                    : inBiz
                    ? 'bg-gray-800/50 border-gray-700/20 hover:bg-blue-900/20 cursor-pointer'
                    : 'bg-gray-900/30 border-gray-700/10 hover:bg-blue-900/10 cursor-pointer'
                }`}
                style={{ height: `${SLOT_HEIGHT}px` }}
                onClick={slotClickable ? () => handleSlotClick(dateStr, slotTime) : undefined}
              >
                <div className="w-16 flex-shrink-0 pr-2 text-right flex items-start justify-end">
                  {idx % 2 === 0 && (
                    <span className="text-gray-500 text-[10px] leading-none mt-1">
                      {formatTime12(slotTime)}
                    </span>
                  )}
                </div>
                <div className="flex-1" />
              </div>
            );
          })}

          {/* Appointment blocks (positioned absolutely, offset for time column) */}
          <div className="absolute inset-0" style={{ left: '64px' }}>
            {dayAppointments.map((apt) => {
              const startMin = toMinutes(apt.start_time);
              const endMin =
                apt.end_time && apt.end_time !== apt.start_time
                  ? toMinutes(apt.end_time)
                  : startMin + 60;

              const top = ((startMin - gridStartMin) / 30) * SLOT_HEIGHT;
              const height = Math.max(((endMin - startMin) / 30) * SLOT_HEIGHT, 24);

              const tech = technicians ? technicians.find((t) => t.id === apt.technician_id) : null;

              const blockStyle = {
                position: 'absolute',
                top: `${top}px`,
                height: `${height}px`,
                left: '2px',
                right: '2px',
                zIndex: 10,
              };

              if (tech && tech.color) {
                blockStyle.borderLeft = `4px solid ${tech.color}`;
                blockStyle.backgroundColor = `${tech.color}20`;
              }

              const isSelectedApt = selectedAppointment && selectedAppointment.id === apt.id;

              return (
                <div
                  key={apt.id}
                  className={`rounded-r-md cursor-pointer transition-all overflow-hidden px-1.5 py-0.5 ${
                    !tech ? 'border-l-4 border-gray-500 bg-gray-600/20' : ''
                  } ${isSelectedApt ? 'ring-2 ring-blue-400 brightness-125' : 'hover:brightness-125'}`}
                  style={blockStyle}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAppointmentClick(apt);
                  }}
                  title={`${apt.name || 'Appointment'} - ${formatTime12(apt.start_time)}`}
                >
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-white text-xs font-medium truncate leading-tight">
                      {apt.name || 'Appointment'}
                    </span>
                    {apt.source === 'ai' || apt.source === 'call' ? (
                      <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400" title="AI booked" />
                    ) : (
                      <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-400" title="Manual" />
                    )}
                  </div>
                  {height >= 50 && (
                    <p className="text-gray-300 text-[11px] leading-tight mt-0.5">
                      {formatTime12(apt.start_time)}
                      {apt.end_time ? ` - ${formatTime12(apt.end_time)}` : ''}
                    </p>
                  )}
                </div>
              );
            })}

            {/* Mobile preview block */}
            {sidePanelMode === 'add' && selectedSlot && selectedSlot.date === dateStr && (
              <div
                className="absolute left-0.5 right-0.5 border-2 border-dashed border-blue-400 bg-blue-600/10 rounded-r-md px-1.5 py-0.5 pointer-events-none"
                style={{
                  top: `${((toMinutes(selectedSlot.time) - gridStartMin) / 30) * SLOT_HEIGHT}px`,
                  height: `${Math.max((previewDuration / 30) * SLOT_HEIGHT, 24)}px`,
                  zIndex: 5,
                }}
              >
                <span className="text-blue-300 text-[11px] font-medium">New appointment</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ─── Tech legend ────────────────────────────────────────────────────────────

  const renderTechLegend = () => {
    if (!technicians || technicians.length === 0) return null;

    const activeTechs = technicians.filter((t) => t.is_active !== false);
    if (activeTechs.length === 0) return null;

    return (
      <div className="flex items-center gap-3 flex-wrap">
        {activeTechs.map((tech) => (
          <div key={tech.id} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: tech.color || '#6b7280' }}
            />
            <span className="text-gray-300 text-xs">{tech.name}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-gray-500" />
          <span className="text-gray-400 text-xs">Unassigned</span>
        </div>
      </div>
    );
  };

  // ─── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Week navigation bar (sticky) */}
      <div className="sticky top-0 z-30 bg-gray-900 pb-2">
        <div className="flex items-center py-3">
          {/* Left: Refresh */}
          <div className="flex-1 flex items-center">
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>

          {/* Center: Week navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={goPreviousWeek}
              className="px-2.5 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 border border-gray-700 text-sm font-medium"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={goToToday}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                isCurrentWeek
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-white hover:bg-gray-700 border border-gray-700'
              }`}
            >
              Current
            </button>
            <button
              onClick={goNextWeek}
              className="px-2.5 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 border border-gray-700 text-sm font-medium"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Right: spacer */}
          <div className="flex-1" />
        </div>

        {/* Week label */}
        <div className="text-center mb-2">
          <p className="text-gray-400 text-sm">
            Week of {formatDateForDisplay(weekDates[0])} - {formatDateForDisplay(weekDates[6])}
          </p>
        </div>

        {/* Tech legend */}
        <div className="flex justify-center mb-2">{renderTechLegend()}</div>

        {/* Mobile day picker (hidden on desktop) */}
        <div className="md:hidden">{renderMobileDayPicker()}</div>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
            <p className="text-gray-400">Loading appointments...</p>
          </div>
        </div>
      ) : (
        /* Main content area: calendar + side panel */
        <div className="flex flex-1 min-h-0 gap-0">
          {/* Calendar grid */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Desktop: 7-column grid */}
            <div className="hidden md:flex flex-col flex-1 min-h-0">
              {renderDesktopGrid()}
            </div>

            {/* Mobile: single day grid */}
            <div className="flex md:hidden flex-col flex-1 min-h-0">
              {renderMobileGrid()}
            </div>
          </div>

          {/* Desktop side panel */}
          {sidePanelMode && (
            <div className="hidden md:block w-[380px] flex-shrink-0 border-l border-gray-700">
              <AppointmentSidePanel
                mode={sidePanelMode}
                selectedSlot={selectedSlot}
                selectedAppointment={selectedAppointment}
                technicians={technicians}
                onSave={handleSave}
                onClose={handleCloseSidePanel}
                onPreviewDurationChange={handlePreviewDurationChange}
                clientId={clientId}
                isMobile={false}
              />
            </div>
          )}

          {/* Mobile side panel (bottom sheet overlay) */}
          {sidePanelMode && (
            <div className="md:hidden fixed inset-0 z-50">
              {/* Backdrop */}
              <div
                className="absolute inset-0 bg-black/60"
                onClick={handleCloseSidePanel}
              />
              {/* Bottom sheet */}
              <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] bg-gray-900 border-t border-gray-700 rounded-t-2xl overflow-auto">
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-10 h-1 rounded-full bg-gray-600" />
                </div>
                <AppointmentSidePanel
                  mode={sidePanelMode}
                  selectedSlot={selectedSlot}
                  selectedAppointment={selectedAppointment}
                  technicians={technicians}
                  onSave={handleSave}
                  onClose={handleCloseSidePanel}
                  onPreviewDurationChange={handlePreviewDurationChange}
                  clientId={clientId}
                  isMobile={true}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state (no appointments at all, not loading) */}
      {!loading && (!appointments || appointments.length === 0) && !sidePanelMode && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <div className="text-center pointer-events-auto">
            <Calendar className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 mb-2">No appointments booked yet</p>
            <p className="text-gray-500 text-sm">Click any time slot to add one</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppointmentCalendar;
