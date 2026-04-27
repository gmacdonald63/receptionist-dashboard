import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Clock, MapPin, Phone, Wrench, FileText, Pencil, Star } from 'lucide-react';
import TimePickerDropdown from './TimePickerDropdown';

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
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hrs} hr${hrs > 1 ? 's' : ''}`;
  return `${hrs}.${mins === 30 ? '5' : mins} hrs`;
}

const BASE = 'w-full px-2.5 py-1.5 bg-gray-750 border rounded-lg text-white placeholder-gray-500 focus:outline-none text-sm';
const INPUT_CLS = `${BASE} border-gray-600 focus:border-blue-500`;
const INPUT_ERR = `${BASE} border-red-500 focus:border-red-400`;

export default function AppointmentSidePanel({
  mode,
  selectedSlot,
  appointment,
  technicians,
  serviceTypes,
  defaultTechnicianId,
  onSave,
  onClose,
  isMobile,
  reviewEnabled,
  reviewMode,
  onSendReviewRequest,
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [technicianId, setTechnicianId] = useState('auto');
  const [serviceType, setServiceType] = useState('');
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState('');
  const [customTime, setCustomTime] = useState(selectedSlot?.time || '');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [sendingReview, setSendingReview] = useState(false);
  const [reviewSent, setReviewSent] = useState(false);
  const [reviewError, setReviewError] = useState('');

  // Group service types by category for the dropdown
  const groupedServiceTypes = React.useMemo(() => {
    if (!serviceTypes || serviceTypes.length === 0) return [];
    const groups = {};
    serviceTypes.forEach(st => {
      if (!groups[st.category]) groups[st.category] = [];
      groups[st.category].push(st);
    });
    return Object.entries(groups);
  }, [serviceTypes]);

  const firstInputRef = useRef(null);

  const editSlot = isEditing && appointment
    ? { date: appointment.date, time: appointment.start_time || appointment.time }
    : null;
  const effectiveSlot = isEditing ? editSlot : selectedSlot;
  const effectiveTime = customTime || effectiveSlot?.time;

  const handleClose = useCallback(() => {
    setIsEditing(false);
    setSaveError('');
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (mode === 'add' && firstInputRef.current) firstInputRef.current.focus();
    if (mode === 'add') { setIsEditing(false); setSaveError(''); }
  }, [mode]);

  // Reset review state when a different appointment is opened
  useEffect(() => {
    setReviewSent(false);
    setReviewError('');
  }, [appointment?.id]);

  // Reset form when a new slot is clicked in add mode
  useEffect(() => {
    if (mode === 'add' && selectedSlot) {
      setFirstName(''); setLastName(''); setPhone('');
      setAddress(''); setCity(''); setState(''); setZip('');
      setNotes(''); setErrors({}); setSaveError('');
      setCustomTime(selectedSlot.time || '');
      setTechnicianId(defaultTechnicianId ? String(defaultTechnicianId) : 'auto');
      setServiceType('');
      setDuration(60);
    }
  }, [selectedSlot]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') handleClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleClose]);

  function startEditing() {
    if (!appointment) return;
    const fn = appointment.first_name || '';
    const ln = appointment.last_name || '';
    if (fn || ln) {
      setFirstName(fn);
      setLastName(ln);
    } else {
      const nameParts = (appointment.caller_name || appointment.customer_name || appointment.name || '').trim().split(' ');
      setFirstName(nameParts[0] || '');
      setLastName(nameParts.slice(1).join(' ') || '');
    }
    setPhone(formatPhone(appointment.caller_number || appointment.phone || ''));
    setAddress(appointment.address || '');
    setCity(appointment.city || '');
    setState(appointment.state || '');
    setZip(appointment.zip || '');
    setTechnicianId(appointment.technician_id ? String(appointment.technician_id) : '');
    setServiceType(appointment.service_type || '');
    setDuration(appointment.duration || 60);
    setNotes(appointment.notes || appointment.summary || '');
    setCustomTime((appointment.start_time || appointment.time) || '');
    setErrors({}); setSaveError('');
    setIsEditing(true);
    setTimeout(() => firstInputRef.current?.focus(), 50);
  }

  function validate() {
    const e = {};
    if (!firstName.trim()) e.firstName = true;
    if (!lastName.trim()) e.lastName = true;
    if (!phone.trim() || phone.replace(/\D/g, '').length < 7) e.phone = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaveError('');
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
        serviceType: serviceType || null,
        duration,
        technicianId: technicianId === 'auto' ? 'auto' : (technicianId || null),
        notes: notes.trim(),
        appointmentId: isEditing ? appointment?.id : undefined,
      });
    } catch (err) {
      console.error('Save failed:', err);
      setSaveError(err?.message || 'Save failed — please try again.');
    } finally {
      setSaving(false);
    }
  }

  const activeTechnicians = (technicians || []).filter(t => t.is_active);

  // ─── Compact form ─────────────────────────────────────────────────────────
  function renderForm(isEditMode) {
    return (
      <form onSubmit={handleSave} className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-white">
            {isEditMode ? 'Edit Appointment' : 'New Appointment'}
          </h2>
          <button type="button" onClick={handleClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-3 pt-2.5 pb-1 space-y-2">
          {/* Date & Time badges */}
          {effectiveSlot && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/15 text-blue-400 rounded-lg text-xs font-medium">
                <Clock size={11} />
                {formatDateDisplay(effectiveSlot.date)}
              </span>
              <TimePickerDropdown
                value={effectiveTime || ''}
                onChange={setCustomTime}
              />
            </div>
          )}

          {/* First + Last */}
          <div className="grid grid-cols-2 gap-1.5">
            <input ref={firstInputRef} type="text" value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="First Name *"
              className={errors.firstName ? INPUT_ERR : INPUT_CLS}
            />
            <input type="text" value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Last Name *"
              className={errors.lastName ? INPUT_ERR : INPUT_CLS}
            />
          </div>

          {/* Phone */}
          <input type="tel" value={phone}
            onChange={e => setPhone(formatPhone(e.target.value))}
            placeholder="Phone *"
            className={errors.phone ? INPUT_ERR : INPUT_CLS}
          />

          {/* Address */}
          <input type="text" value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Address"
            className={INPUT_CLS}
          />

          {/* City / State / ZIP */}
          <div className="grid grid-cols-5 gap-1.5">
            <input type="text" value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="City"
              className={`${INPUT_CLS} col-span-3`}
            />
            <input type="text" value={state}
              onChange={e => setState(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="ST" maxLength={2}
              className={`${INPUT_CLS} col-span-1 text-center uppercase`}
            />
            <input type="text" value={zip}
              onChange={e => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="ZIP" maxLength={5}
              className={`${INPUT_CLS} col-span-1`}
            />
          </div>

          {/* Service Type */}
          {groupedServiceTypes.length > 0 && (
            <select value={serviceType} onChange={e => {
              const name = e.target.value;
              setServiceType(name);
              if (name) {
                const match = (serviceTypes || []).find(st => st.name === name);
                if (match) setDuration(match.duration_minutes);
              }
            }}
              className={`${INPUT_CLS} appearance-none`}>
              <option value="">Service Type (optional)</option>
              {groupedServiceTypes.map(([category, types]) => (
                <optgroup key={category} label={category}>
                  {types.map(st => (
                    <option key={st.id} value={st.name}>{st.name} ({formatDuration(st.duration_minutes)})</option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}

          {/* Technician + Duration */}
          <div className="grid grid-cols-2 gap-1.5">
            <select value={technicianId} onChange={e => setTechnicianId(e.target.value)}
              className={`${INPUT_CLS} appearance-none`}>
              <option value="auto">Auto-assign (least busy)</option>
              <option value="">Unassigned</option>
              {activeTechnicians.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <select value={duration} onChange={e => setDuration(parseInt(e.target.value))}
              className={`${INPUT_CLS} appearance-none`}>
              <option value={30}>30 min</option>
              <option value={60}>1 hr</option>
              <option value={90}>1.5 hrs</option>
              <option value={120}>2 hrs</option>
              <option value={180}>3 hrs</option>
              <option value={240}>4 hrs</option>
              <option value={360}>6 hrs</option>
              <option value={480}>8 hrs</option>
            </select>
          </div>

          {/* Notes */}
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)" rows={2}
            className={`${INPUT_CLS} resize-none`}
          />

          {/* Save error */}
          {saveError && (
            <p className="text-red-400 text-xs px-0.5">{saveError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-gray-700 mt-2">
          <button type="button"
            onClick={isEditMode ? () => { setIsEditing(false); setSaveError(''); } : handleClose}
            disabled={saving}
            className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Save'}
          </button>
        </div>
      </form>
    );
  }

  // ─── View mode ─────────────────────────────────────────────────────────────
  function renderViewMode() {
    if (!appointment) return null;

    const apptName =
      [appointment.caller_name, appointment.customer_name, appointment.first_name, appointment.name]
        .filter(Boolean).find(n => n.trim()) || 'Appointment';

    const sourceBadgeCls = appointment.source === 'ai' || appointment.source === 'call'
      ? 'bg-blue-500/15 text-blue-400' : 'bg-green-500/15 text-green-400';
    const sourceLabel = appointment.source === 'ai' || appointment.source === 'call' ? 'AI' : 'Manual';

    const matchedTech = (technicians || []).find(t => String(t.id) === String(appointment.technician_id));
    const apptTime = appointment.start_time || appointment.time;
    const apptAddress = [
      appointment.address,
      appointment.city,
      appointment.state ? `${appointment.state} ${appointment.zip || ''}`.trim() : appointment.zip,
    ].filter(Boolean).join(', ');
    const apptNotes = appointment.notes || appointment.summary;

    return (
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-white truncate pr-2">{apptName}</h2>
          <button type="button" onClick={handleClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-2.5">
          {/* Source + Tech */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${sourceBadgeCls}`}>
              {sourceLabel}
            </span>
            {matchedTech ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-gray-300">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: matchedTech.color || '#6b7280' }} />
                {matchedTech.name}
              </span>
            ) : (
              <span className="text-sm text-gray-500">Unassigned</span>
            )}
          </div>

          {appointment.date && (
            <div className="flex items-start gap-3">
              <Clock size={14} className="text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-white">{formatDateDisplay(appointment.date)}</p>
                <p className="text-sm text-gray-400">
                  {apptTime ? formatTime12(apptTime) : ''}
                  {appointment.duration ? ` · ${formatDuration(appointment.duration)}` : ''}
                </p>
              </div>
            </div>
          )}

          {(appointment.caller_number || appointment.phone) && (
            <div className="flex items-center gap-3">
              <Phone size={14} className="text-gray-500 flex-shrink-0" />
              <p className="text-sm text-white">{appointment.caller_number || appointment.phone}</p>
            </div>
          )}

          {apptAddress && (
            <div className="flex items-start gap-3">
              <MapPin size={14} className="text-gray-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-white">{apptAddress}</p>
            </div>
          )}

          {appointment.service_type && (
            <div className="flex items-center gap-3">
              <Wrench size={14} className="text-gray-500 flex-shrink-0" />
              <p className="text-sm text-white">{appointment.service_type}</p>
            </div>
          )}

          {apptNotes && (
            <div className="flex items-start gap-3">
              <FileText size={14} className="text-gray-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{apptNotes}</p>
            </div>
          )}
        </div>

        {/* Review request footer */}
        {reviewEnabled && appointment.status === 'complete' && (
          <div className="px-4 pb-2.5">
            {appointment.review_sms_sent_at || reviewSent ? (
              <div className="flex items-center justify-center gap-2 py-2 rounded-lg bg-green-900/30 text-green-400 text-sm">
                <Star size={13} className="fill-green-400" />
                Review request sent
              </div>
            ) : reviewMode === 'auto' ? (
              <div className="flex items-center justify-center gap-2 py-2 rounded-lg bg-gray-750 text-gray-400 text-sm">
                <Star size={13} />
                Review SMS sent automatically
              </div>
            ) : (
              <div>
                <button
                  onClick={async () => {
                    setSendingReview(true);
                    setReviewError('');
                    const result = await onSendReviewRequest(appointment);
                    setSendingReview(false);
                    if (result?.ok && !result?.skipped) {
                      setReviewSent(true);
                    } else if (result?.error) {
                      setReviewError(result.error);
                    }
                  }}
                  disabled={sendingReview}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Star size={13} />
                  {sendingReview ? 'Sending...' : 'Send Review Request'}
                </button>
                {reviewError && <p className="text-red-400 text-xs mt-1 text-center">{reviewError}</p>}
              </div>
            )}
          </div>
        )}

        {/* Edit footer */}
        <div className="px-4 py-2.5 border-t border-gray-700">
          <button onClick={startEditing}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
            <Pencil size={13} />
            Edit Appointment
          </button>
        </div>
      </div>
    );
  }

  // No self-managed overlay — AppointmentCalendar owns the mobile bottom-sheet wrapper
  return (
    <div className={isMobile ? 'bg-gray-900' : 'w-full bg-gray-800'}>
      {mode === 'add' || isEditing ? renderForm(isEditing) : renderViewMode()}
    </div>
  );
}
