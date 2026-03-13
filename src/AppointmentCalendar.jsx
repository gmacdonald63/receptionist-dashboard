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
  headerLeft,
  headerRight,
}) => {
  // Internal state
  const [sidePanelMode, setSidePanelMode] = useState(null); // null | 'add' | 'view'
  const [selectedSlot, setSelectedSlot] = useState(null); // { date, time }
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [previewDuration, setPreviewDuration] = useState(60);
  const [mobileSelectedDay, setMobileSelectedDay] = useState(() => new Date());

  // Tech filter: null = show all, number = show only that tech's appointments
  // localStorage so the filter survives tab close / session reload
  const [selectedTechId, setSelectedTechId] = useState(() => {
    try {
      const stored = localStorage.getItem('calendarFilterTechId');
      return stored ? Number(stored) : null;
    } catch { return null; }
  });

  // Day view drill-down: null = week view, Date = day view for that date
  const [dayViewDate, setDayViewDate] = useState(null);

  const scrollContainerRef = useRef(null);
  const touchStartXRef = useRef(null);

  const weekDates = useMemo(() => getWeekDates(currentWeekStart), [currentWeekStart]);

  // Only show columns for days that are configured as open (or all 7 if no config loaded yet)
  const visibleWeekDates = useMemo(() => {
    if (!businessHours || businessHours.length === 0) return weekDates;
    return weekDates.filter(date => {
      const bh = businessHours.find(h => h.day_of_week === date.getDay());
      return !bh || bh.is_open; // show if unconfigured (open by default) or explicitly open
    });
  }, [weekDates, businessHours]);

  const todayStr = useMemo(() => formatDateStr(new Date()), []);

  const isCurrentWeek = useMemo(() => {
    const today = new Date();
    const todaySunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    return formatDateStr(todaySunday) === formatDateStr(currentWeekStart);
  }, [currentWeekStart]);

  // Sync selectedTechId to localStorage (persists across sessions)
  useEffect(() => {
    try {
      if (selectedTechId) {
        localStorage.setItem('calendarFilterTechId', String(selectedTechId));
      } else {
        localStorage.removeItem('calendarFilterTechId');
      }
    } catch {}
  }, [selectedTechId]);

  // Validate stored tech against loaded technicians — clear if no longer valid
  useEffect(() => {
    if (selectedTechId && technicians && technicians.length > 0) {
      const techStillActive = technicians.some(t => t.id === selectedTechId && t.is_active !== false);
      if (!techStillActive) setSelectedTechId(null);
    }
  }, [technicians]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Filtered view: when a tech is selected, only show that tech's appointments
  const filteredAppointmentsByDate = useMemo(() => {
    if (!selectedTechId) return appointmentsByDate;
    const filtered = {};
    for (const [date, apts] of Object.entries(appointmentsByDate)) {
      const techApts = apts.filter(apt => apt.technician_id === selectedTechId);
      if (techApts.length > 0) filtered[date] = techApts;
    }
    return filtered;
  }, [appointmentsByDate, selectedTechId]);

  // ─── Sub-column (multi-tech) layout computed values ─────────────────────────

  const activeTechs = useMemo(() => {
    return technicians ? technicians.filter(t => t.is_active !== false) : [];
  }, [technicians]);

  // Show sub-columns when no filter is active and there are active techs
  const showSubColumns = !selectedTechId && activeTechs.length > 0;

  // Sub-column definitions: each active tech + Unassigned at end
  const subColumns = useMemo(() => {
    if (!showSubColumns) return [];
    return [
      ...activeTechs.map(t => ({ id: t.id, name: t.name, color: t.color || '#6b7280' })),
      { id: null, name: 'Unassigned', color: '#6b7280' },
    ];
  }, [activeTechs, showSubColumns]);

  // Bucket appointments by date → tech key for sub-column rendering
  const appointmentsByDateAndTech = useMemo(() => {
    if (!showSubColumns) return {};
    const map = {};
    for (const [date, apts] of Object.entries(appointmentsByDate)) {
      map[date] = {};
      for (const apt of apts) {
        const key = apt.technician_id != null ? String(apt.technician_id) : 'unassigned';
        if (!map[date][key]) map[date][key] = [];
        map[date][key].push(apt);
      }
    }
    return map;
  }, [appointmentsByDate, showSubColumns]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSlotClick = useCallback((dateStr, timeStr, techId = undefined) => {
    setSelectedSlot({
      date: dateStr,
      time: timeStr,
      // In sub-col mode: use passed techId; in filter mode: inherit selectedTechId
      techId: techId !== undefined ? techId : (selectedTechId ?? null),
    });
    setSelectedAppointment(null);
    setSidePanelMode('add');
    setPreviewDuration(60);
  }, [selectedTechId]);

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
    // Exit day view when navigating to a different week
    setDayViewDate(null);
  }, [currentWeekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to current time when entering day view
  useEffect(() => {
    if (!dayViewDate || !scrollContainerRef.current) return;
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const scrollTarget = ((currentMin - gridStartMin) / 30) * SLOT_HEIGHT;
    scrollContainerRef.current.scrollTop = Math.max(0, scrollTarget - 200);
  }, [dayViewDate, gridStartMin]);

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

  const renderPreviewBlock = (dateStr, subColTechId = undefined) => {
    if (sidePanelMode !== 'add' || !selectedSlot || selectedSlot.date !== dateStr) return null;
    // In sub-column mode: only show in the matching tech's column
    if (subColTechId !== undefined && (selectedSlot.techId ?? null) !== subColTechId) return null;

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

  // ─── Tech sub-column (Phase 3: all-tech week view) ──────────────────────────

  const renderTechSubColumn = (date, sc, isLastSubCol, isLastDay) => {
    const dateStr = formatDateStr(date);
    const dayOfWeek = date.getDay();
    const closed = isDayClosed(dayOfWeek);
    const isUnassigned = sc.id == null;
    const techKey = isUnassigned ? 'unassigned' : String(sc.id);
    const subColApts = appointmentsByDateAndTech[dateStr]?.[techKey] || [];

    return (
      <div key={techKey} className="relative flex-1" style={{ minWidth: '44px' }}>
        {/* Slot cells */}
        {timeSlots.map((slotTime) => {
          const inBiz = isSlotInBusinessHours(dayOfWeek, slotTime);
          const isDayBorder = isLastSubCol && !isLastDay; // bold line between days
          const isTechBorder = !isLastSubCol; // thin line between techs
          return (
            <div
              key={slotTime}
              className={`border-b ${isDayBorder ? 'border-r-2 border-r-gray-500' : isTechBorder ? 'border-r border-r-gray-700/10' : ''} ${
                closed
                  ? 'bg-gray-900/50 cursor-not-allowed'
                  : isUnassigned
                  ? inBiz
                    ? 'bg-gray-800/20 hover:bg-gray-700/30 cursor-pointer'
                    : 'bg-gray-900/20 hover:bg-gray-800/20 cursor-pointer'
                  : inBiz
                  ? 'bg-gray-800/50 hover:bg-blue-900/20 cursor-pointer'
                  : 'bg-gray-900/30 hover:bg-blue-900/10 cursor-pointer'
              } border-b-gray-700/20`}
              style={{ height: `${SLOT_HEIGHT}px` }}
              title={isUnassigned && !closed ? 'Unassigned — tech TBD. Assign before day of service.' : undefined}
              onClick={!closed ? () => handleSlotClick(dateStr, slotTime, sc.id) : undefined}
            />
          );
        })}
        {/* Appointment blocks */}
        {subColApts.map((apt) => renderAppointmentBlock(apt, dayOfWeek, dateStr))}
        {/* Preview block (only for matching sub-column) */}
        {renderPreviewBlock(dateStr, sc.id)}
      </div>
    );
  };

  const renderDayColumn = (date, isLastColumn) => {
    const dateStr = formatDateStr(date);
    const dayOfWeek = date.getDay();
    const closed = isDayClosed(dayOfWeek);

    // Sub-column mode: flex row of per-tech columns
    if (showSubColumns) {
      return (
        <div key={dateStr} className="flex" style={{ minWidth: 0 }}>
          {subColumns.map((sc, scIdx) =>
            renderTechSubColumn(date, sc, scIdx === subColumns.length - 1, isLastColumn)
          )}
        </div>
      );
    }

    // Single-column mode (filter active or no techs)
    const dayAppointments = filteredAppointmentsByDate[dateStr] || [];
    return (
      <div key={dateStr} className="relative" style={{ minWidth: 0 }}>
        {/* Background slot cells */}
        {timeSlots.map((slotTime) => {
          const inBiz = isSlotInBusinessHours(dayOfWeek, slotTime);
          const slotClickable = !closed;

          return (
            <div
              key={slotTime}
              className={`border-b ${isLastColumn ? '' : 'border-r-2 border-r-gray-500'} ${
                closed
                  ? 'bg-gray-900/50 border-b-gray-700/10 cursor-not-allowed'
                  : inBiz
                  ? 'bg-gray-800/50 border-b-gray-700/20 hover:bg-blue-900/20 cursor-pointer'
                  : 'bg-gray-900/30 border-b-gray-700/10 hover:bg-blue-900/10 cursor-pointer'
              }`}
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
      className="flex-1 overflow-auto border-2 border-gray-500 rounded-lg bg-gray-900"
    >
      <div
        className="grid min-w-0"
        style={{
          gridTemplateColumns: `60px repeat(${visibleWeekDates.length}, 1fr)`,
        }}
      >
        {/* Header row */}
        <div className="sticky top-0 z-20 bg-gray-900 border-b border-gray-700" />
        {visibleWeekDates.map((date, idx) => {
          const isToday = formatDateStr(date) === todayStr;
          const isLastCol = idx === visibleWeekDates.length - 1;
          return (
            <div
              key={formatDateStr(date)}
              className={`sticky top-0 z-20 bg-gray-900 border-b border-gray-700 text-center overflow-hidden ${isLastCol ? '' : 'border-r-2 border-r-gray-500'}`}
            >
              {/* Day name + date — clickable to drill into day view */}
              <div
                className="px-2 py-1.5 cursor-pointer hover:bg-gray-800/60 transition-colors group"
                onClick={() => setDayViewDate(date)}
                title={`View ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`}
              >
                <p className="text-xs font-medium text-gray-400 group-hover:text-blue-400 transition-colors">
                  {formatDayName(date)}
                </p>
                <div className="flex items-center justify-center gap-1">
                  <p className={`text-sm font-semibold ${isToday ? 'text-blue-400' : 'text-white'}`}>
                    {date.getDate()}
                  </p>
                  {isToday && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                </div>
              </div>
              {/* Sub-column tech indicators */}
              {showSubColumns && (
                <div className="flex border-t border-gray-700/40">
                  {subColumns.map((sc) => (
                    <div
                      key={sc.id ?? 'u'}
                      className="flex-1 flex items-center justify-center py-1"
                      style={{ minWidth: '44px' }}
                      title={sc.name}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: sc.color }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Time labels column + day columns (rendered per row for the time label, but days are separate) */}
      </div>

      {/* Scrollable body grid */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `60px repeat(${visibleWeekDates.length}, 1fr)`,
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
        {visibleWeekDates.map((date, idx) => renderDayColumn(date, idx === visibleWeekDates.length - 1))}
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
            className={`flex-shrink-0 flex flex-col items-center px-3 py-2 min-h-[44px] rounded-xl transition-colors ${
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
    const dayAppointments = filteredAppointmentsByDate[dateStr] || [];

    const handleSwipeStart = (e) => {
      touchStartXRef.current = e.touches[0].clientX;
    };
    const handleSwipeEnd = (e) => {
      if (touchStartXRef.current === null) return;
      const delta = e.changedTouches[0].clientX - touchStartXRef.current;
      touchStartXRef.current = null;
      if (Math.abs(delta) < 50) return; // ignore incidental swipes
      const direction = delta < 0 ? 1 : -1; // left swipe = next day, right = prev
      const newDay = new Date(mobileSelectedDay);
      newDay.setDate(newDay.getDate() + direction);
      setMobileSelectedDay(newDay);
      // Advance week if the new day falls outside the current week
      const newWeekDates = getWeekDates(currentWeekStart);
      const inWeek = newWeekDates.some((d) => formatDateStr(d) === formatDateStr(newDay));
      if (!inWeek) {
        const newWeek = new Date(currentWeekStart);
        newWeek.setDate(newWeek.getDate() + direction * 7);
        onWeekChange(newWeek);
      }
    };

    return (
      <div
        className="flex-1 flex flex-col min-h-0"
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
      >
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto border-2 border-gray-500 rounded-lg bg-gray-900"
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
              // Mobile touch target minimum: 44px (WCAG 2.5.5) — desktop uses 24px
              const height = Math.max(((endMin - startMin) / 30) * SLOT_HEIGHT, 44);

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
      </div>
    );
  };

  // ─── Day view (drill-down from week header click) ───────────────────────────

  const renderDayView = () => {
    if (!dayViewDate) return null;
    const dateStr = formatDateStr(dayViewDate);
    const dayOfWeek = dayViewDate.getDay();
    const closed = isDayClosed(dayOfWeek);

    return (
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto border-2 border-gray-500 rounded-lg bg-gray-900"
      >
        {/* Sub-column header row */}
        <div className="sticky top-0 z-20 flex bg-gray-900 border-b border-gray-700">
          {/* Time label spacer */}
          <div className="w-[60px] flex-shrink-0" />
          {/* Sub-column names (or single header in filter mode) */}
          {showSubColumns ? (
            subColumns.map((sc) => (
              <div
                key={sc.id ?? 'u'}
                className="flex-1 flex flex-col items-center py-2"
                style={{ minWidth: '52px' }}
              >
                <span
                  className="w-3 h-3 rounded-full mb-0.5"
                  style={{ backgroundColor: sc.color }}
                />
                <span className="text-[10px] text-gray-400 leading-tight text-center truncate px-1 max-w-full">
                  {sc.name}
                </span>
              </div>
            ))
          ) : (
            <div className="flex-1 py-2 text-center">
              <p className="text-xs text-gray-400">
                {selectedTechId
                  ? activeTechs.find((t) => t.id === selectedTechId)?.name || 'Tech'
                  : 'All Appointments'}
              </p>
            </div>
          )}
        </div>

        {/* Body: time labels + content */}
        <div className="flex">
          {/* Time labels */}
          <div className="w-[60px] flex-shrink-0">
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

          {/* Day content: sub-columns or single column */}
          {showSubColumns ? (
            <div className="flex flex-1">
              {subColumns.map((sc, scIdx) =>
                renderTechSubColumn(dayViewDate, sc, scIdx === subColumns.length - 1, true)
              )}
            </div>
          ) : (
            <div className="relative flex-1">
              {timeSlots.map((slotTime) => {
                const inBiz = isSlotInBusinessHours(dayOfWeek, slotTime);
                return (
                  <div
                    key={slotTime}
                    className={`border-b ${
                      closed
                        ? 'bg-gray-900/50 cursor-not-allowed'
                        : inBiz
                        ? 'bg-gray-800/50 hover:bg-blue-900/20 cursor-pointer'
                        : 'bg-gray-900/30 hover:bg-blue-900/10 cursor-pointer'
                    } border-gray-700/20`}
                    style={{ height: `${SLOT_HEIGHT}px` }}
                    onClick={!closed ? () => handleSlotClick(dateStr, slotTime) : undefined}
                  />
                );
              })}
              {(filteredAppointmentsByDate[dateStr] || []).map((apt) =>
                renderAppointmentBlock(apt, dayOfWeek, dateStr)
              )}
              {renderPreviewBlock(dateStr)}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── Tech legend (clickable filter pills) ───────────────────────────────────

  const renderTechLegend = () => {
    if (!technicians || technicians.length === 0) return null;

    const activeTechs = technicians.filter((t) => t.is_active !== false);
    if (activeTechs.length === 0) return null;

    const handleTechClick = (techId) => {
      setSelectedTechId(prev => prev === techId ? null : techId);
    };

    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* "All" reset pill — only visible when a filter is active */}
        {selectedTechId && (
          <button
            onClick={() => setSelectedTechId(null)}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-500 transition-colors"
          >
            All
          </button>
        )}
        {activeTechs.map((tech) => {
          const isActive = selectedTechId === tech.id;
          return (
            <button
              key={tech.id}
              onClick={() => handleTechClick(tech.id)}
              title={isActive ? `Clear filter` : `View only ${tech.name}`}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-gray-700 text-white border-2'
                  : selectedTechId
                  ? 'bg-gray-800/60 text-gray-500 border border-gray-700 hover:bg-gray-700 hover:text-gray-300'
                  : 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white'
              }`}
              style={isActive ? { borderColor: tech.color || '#6b7280' } : {}}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: tech.color || '#6b7280' }}
              />
              {tech.name}
            </button>
          );
        })}
      </div>
    );
  };

  // ─── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Week navigation bar (sticky) */}
      <div className="sticky top-0 z-30 bg-gray-900 pb-2">
        <div className="flex items-center pb-3 gap-3">
          {/* Left: Logo slot + Refresh */}
          <div className="flex-1 flex items-center gap-3">
            {headerLeft}
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>

          {/* Center: Week navigation (or day view title + back) */}
          {dayViewDate ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDayViewDate(null)}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 border border-gray-700 text-sm font-medium"
              >
                <ChevronLeft className="w-4 h-4" />
                Week
              </button>
              <span className="text-white font-semibold text-sm">
                {dayViewDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </span>
            </div>
          ) : (
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
          )}

          {/* Right: legend + action slot */}
          <div className="flex-1 flex items-center justify-end gap-3">
            <div className="hidden sm:flex">{renderTechLegend()}</div>
            {headerRight}
          </div>
        </div>

        {/* Mobile day picker (hidden on desktop) */}
        <div className="md:hidden">{renderMobileDayPicker()}</div>

        {/* Active filter badge — persistent amber banner when a tech filter is active */}
        {selectedTechId && (() => {
          const tech = technicians ? technicians.find(t => t.id === selectedTechId) : null;
          if (!tech) return null;
          return (
            <div className="flex items-center justify-between px-3 py-1.5 bg-amber-900/30 border border-amber-600/40 rounded-lg mt-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tech.color || '#f59e0b' }} />
                <span className="text-amber-300 text-xs font-medium">
                  Viewing {tech.name} only — other appointments hidden
                </span>
              </div>
              <button
                onClick={() => setSelectedTechId(null)}
                className="text-amber-400 hover:text-amber-200 text-xs underline ml-3 flex-shrink-0"
              >
                Show all
              </button>
            </div>
          );
        })()}
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
            {/* Desktop: week grid OR day view */}
            <div className="hidden md:flex flex-col flex-1 min-h-0">
              {dayViewDate ? renderDayView() : renderDesktopGrid()}
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
                appointment={selectedAppointment}
                technicians={technicians}
                defaultTechnicianId={selectedSlot?.techId ?? selectedTechId}
                onSave={handleSave}
                onClose={handleCloseSidePanel}
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
                  appointment={selectedAppointment}
                  technicians={technicians}
                  defaultTechnicianId={selectedSlot?.techId ?? selectedTechId}
                  onSave={handleSave}
                  onClose={handleCloseSidePanel}
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
