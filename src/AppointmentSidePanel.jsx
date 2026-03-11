import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Clock, MapPin, User, Phone, Wrench, FileText, Pencil } from 'lucide-react';

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatTime12(hhmm) {
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr);
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${period}`;
}

function formatDateDisplay(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hrs} hr${hrs > 1 ? 's' : ''}`;
  return `${hrs}.${mins === 30 ? '5' : mins} hrs`;
}

export default function AppointmentSidePanel({
  mode,
  selectedSlot,
  appointment,
  technicians,
  defaultTechnicianId,
  onSave,
  onClose,
  isMobile,
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState('');
  const [showCustomTime, setShowCustomTime] = useState(false);
  const [customTime, setCustomTime] = useState(selectedSlot?.time || '');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [isEditing, setIsEditing] = useState(false);

  const panelRef = useRef(null);
  const firstInputRef = useRef(null);

  // When in edit mode, derive the slot from the appointment being edited
  const editSlot = isEditing && appointment
    ? { date: appointment.date, time: appointment.start_time || appointment.time }
    : null;
  const effectiveSlot = isEditing ? editSlot : selectedSlot;
  const effectiveTime = showCustomTime && customTime ? customTime : effectiveSlot?.time;

  useEffect(() => {
    if (mode === 'add' && firstInputRef.current) {
      firstInputRef.current.focus();
    }
    // Reset edit mode when switching away from view
    if (mode === 'add') setIsEditing(false);
  }, [mode]);

  // When a new slot is clicked (add mode), reset form and pre-fill tech filter
  useEffect(() => {
    if (mode === 'add' && selectedSlot) {
      setFirstName('');
      setLastName('');
      setPhone('');
      setAddress('');
      setCity('');
      setState('');
      setZip('');
      setNotes('');
      setErrors({});
      setShowCustomTime(false);
      setCustomTime(selectedSlot.time || '');
      setTechnicianId(defaultTechnicianId ? String(defaultTechnicianId) : '');
      setDuration(60);
    }
  }, [selectedSlot]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => {
    setIsEditing(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  function startEditing() {
    if (!appointment) return;
    const nameParts = (appointment.caller_name || appointment.customer_name || appointment.name || '').trim().split(' ');
    setFirstName(nameParts[0] || '');
    setLastName(nameParts.slice(1).join(' ') || '');
    setPhone(formatPhone(appointment.caller_number || appointment.phone || appointment.customer_phone || ''));
    setAddress(appointment.address || '');
    setCity(appointment.city || '');
    setState(appointment.state || '');
    setZip(appointment.zip || '');
    setTechnicianId(appointment.technician_id ? String(appointment.technician_id) : '');
    setDuration(appointment.duration || 60);
    setNotes(appointment.notes || '');
    setShowCustomTime(false);
    setCustomTime((appointment.start_time || appointment.time) || '');
    setErrors({});
    setIsEditing(true);
    setTimeout(() => firstInputRef.current?.focus(), 50);
  }

  function handlePhoneChange(e) {
    setPhone(formatPhone(e.target.value));
  }

  function handleStateChange(e) {
    setState(e.target.value.toUpperCase().slice(0, 2));
  }

  function handleZipChange(e) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 5);
    setZip(digits);
  }

  function validate() {
    const newErrors = {};
    if (!firstName.trim()) newErrors.firstName = true;
    if (!lastName.trim()) newErrors.lastName = true;
    if (!phone.trim() || phone.replace(/\D/g, '').length < 7) newErrors.phone = true;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      await onSave({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        zip: zip.trim(),
        date: effectiveSlot?.date,
        time: effectiveTime,
        duration,
        technicianId: technicianId || null,
        notes: notes.trim(),
        appointmentId: isEditing ? appointment?.id : undefined,
      });
    } catch (err) {
      console.error('Failed to save appointment:', err);
    } finally {
      setSaving(false);
    }
  }

  const activeTechnicians = (technicians || []).filter((t) => t.is_active);

  function renderForm(isEditMode) {
    return (
      <form onSubmit={handleSave} className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-white">
            {isEditMode ? 'Edit Appointment' : 'New Appointment'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
          {/* Date & Time Badges */}
          {effectiveSlot && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-500/15 text-blue-400 rounded-lg text-sm font-medium">
                <Clock size={13} />
                {formatDateDisplay(effectiveSlot.date)}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-500/15 text-blue-400 rounded-lg text-sm font-medium">
                {effectiveTime ? formatTime12(effectiveTime) : '—'}
              </span>
            </div>
          )}

          {/* First Name + Last Name */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                First Name <span className="text-red-400">*</span>
              </label>
              <input
                ref={firstInputRef}
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                className={`w-full px-3 py-1.5 bg-gray-750 border ${
                  errors.firstName ? 'border-red-500' : 'border-gray-600'
                } rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Last Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Smith"
                className={`w-full px-3 py-1.5 bg-gray-750 border ${
                  errors.lastName ? 'border-red-500' : 'border-gray-600'
                } rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm`}
              />
            </div>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Phone <span className="text-red-400">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={handlePhoneChange}
              placeholder="(503) 555-0123"
              className={`w-full px-3 py-1.5 bg-gray-750 border ${
                errors.phone ? 'border-red-500' : 'border-gray-600'
              } rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm`}
            />
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main Street"
              className="w-full px-3 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>

          {/* City / State / ZIP */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Portland"
                className="w-full px-3 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">State</label>
              <input
                type="text"
                value={state}
                onChange={handleStateChange}
                placeholder="OR"
                maxLength={2}
                className="w-full px-3 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm uppercase"
              />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">ZIP</label>
              <input
                type="text"
                value={zip}
                onChange={handleZipChange}
                placeholder="97201"
                maxLength={5}
                className="w-full px-3 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Technician + Duration side by side */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Technician</label>
              <select
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                className="w-full px-3 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm appearance-none"
              >
                <option value="">Unassigned</option>
                {activeTechnicians.map((tech) => (
                  <option key={tech.id} value={tech.id}>
                    {tech.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Duration</label>
              <select
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value))}
                className="w-full px-3 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm appearance-none"
              >
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Service details, special instructions..."
              rows={2}
              className="w-full px-3 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm resize-none"
            />
          </div>

          {/* Other Time */}
          {!showCustomTime ? (
            <button
              type="button"
              onClick={() => setShowCustomTime(true)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Other time (emergency booking)
            </button>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Custom Time</label>
              <input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className="w-full px-3 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
              />
              <button
                type="button"
                onClick={() => { setShowCustomTime(false); setCustomTime(effectiveSlot?.time || ''); }}
                className="mt-1 text-xs text-gray-500 hover:text-gray-400 transition-colors"
              >
                Use original time
              </button>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-700 flex-shrink-0">
          <button
            type="button"
            onClick={isEditMode ? () => setIsEditing(false) : handleClose}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Save'}
          </button>
        </div>
      </form>
    );
  }

  function renderViewMode() {
    if (!appointment) return null;

    const apptName =
      [appointment.caller_name, appointment.customer_name, appointment.first_name, appointment.name]
        .filter(Boolean)
        .find((n) => n.trim()) || 'Appointment';

    const sourceLabel =
      appointment.source === 'ai' || appointment.source === 'call' ? 'AI' : 'Manual';
    const sourceBadgeClass =
      appointment.source === 'ai' || appointment.source === 'call'
        ? 'bg-blue-500/15 text-blue-400'
        : 'bg-green-500/15 text-green-400';

    const matchedTech = (technicians || []).find(
      (t) => String(t.id) === String(appointment.technician_id)
    );

    const apptDate = appointment.date;
    const apptTime = appointment.start_time || appointment.time;
    const apptDuration = appointment.duration;
    const apptPhone =
      appointment.caller_number || appointment.phone || appointment.customer_phone || appointment.caller_phone;
    const apptAddress = [
      appointment.address,
      appointment.city,
      appointment.state ? `${appointment.state} ${appointment.zip || ''}`.trim() : appointment.zip,
    ]
      .filter(Boolean)
      .join(', ');
    const apptNotes = appointment.notes || appointment.summary;
    const apptServiceType = appointment.service_type;

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-white truncate pr-2">{apptName}</h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Source badge + tech */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${sourceBadgeClass}`}>
              {sourceLabel}
            </span>
            {matchedTech ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-gray-300">
                <span
                  className="w-3 h-3 rounded-full inline-block flex-shrink-0"
                  style={{ backgroundColor: matchedTech.color || '#6b7280' }}
                />
                {matchedTech.name}
              </span>
            ) : (
              <span className="text-sm text-gray-500">Unassigned</span>
            )}
          </div>

          {/* Date & Time */}
          {apptDate && (
            <div className="flex items-start gap-3">
              <Clock size={15} className="text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-white">{formatDateDisplay(apptDate)}</p>
                <p className="text-sm text-gray-400">
                  {apptTime ? formatTime12(apptTime) : ''}
                  {apptDuration ? ` · ${formatDuration(apptDuration)}` : ''}
                </p>
              </div>
            </div>
          )}

          {/* Phone */}
          {apptPhone && (
            <div className="flex items-start gap-3">
              <Phone size={15} className="text-gray-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-white">{apptPhone}</p>
            </div>
          )}

          {/* Address */}
          {apptAddress && (
            <div className="flex items-start gap-3">
              <MapPin size={15} className="text-gray-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-white">{apptAddress}</p>
            </div>
          )}

          {/* Service Type */}
          {apptServiceType && (
            <div className="flex items-start gap-3">
              <Wrench size={15} className="text-gray-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-white">{apptServiceType}</p>
            </div>
          )}

          {/* Notes */}
          {apptNotes && (
            <div className="flex items-start gap-3">
              <FileText size={15} className="text-gray-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{apptNotes}</p>
            </div>
          )}
        </div>

        {/* Footer with Edit button */}
        <div className="px-4 py-2.5 border-t border-gray-700 flex-shrink-0">
          <button
            onClick={startEditing}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Pencil size={14} />
            Edit Appointment
          </button>
        </div>
      </div>
    );
  }

  const panelContent = (
    <div
      ref={panelRef}
      className={
        isMobile
          ? 'bg-gray-800 rounded-t-2xl max-h-[85vh] overflow-y-auto w-full'
          : 'w-[380px] border-l border-gray-700 bg-gray-800 overflow-y-auto h-full'
      }
    >
      {mode === 'add' || isEditing ? renderForm(isEditing) : renderViewMode()}
    </div>
  );

  if (isMobile) {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
      >
        {panelContent}
      </div>
    );
  }

  return panelContent;
}
