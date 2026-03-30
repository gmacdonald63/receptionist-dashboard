// src/utils/locationService.js
import { supabase } from '../supabaseClient.js';

// ── Named constants ────────────────────────────────────────────────────────
const WRITE_DISTANCE_METERS = 50;
const MAX_SPEED_KMH = 200;
const WATCHDOG_INTERVAL_MS = 30_000;
const WATCHDOG_SILENCE_THRESHOLD_MS = 45_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const HEARTBEAT_TRIGGER_THRESHOLD_MS = 55_000;
const GPS_MAX_AGE_MS = 15_000;
const GPS_TIMEOUT_MS = 10_000;
const STATIONARY_SPEED_KMH = 3;
const MAX_QUEUE = 200;

// ── Pure helpers (exported for tests) ─────────────────────────────────────
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function shouldWriteLocation(lastLat, lastLng, newLat, newLng) {
  if (lastLat === null || lastLng === null) return true;
  return haversineMeters(lastLat, lastLng, newLat, newLng) >= WRITE_DISTANCE_METERS;
}

export function isSaneSpeed(speedKmh) {
  if (speedKmh === null || speedKmh === undefined) return true;
  return speedKmh >= 0 && speedKmh <= MAX_SPEED_KMH;
}

// ── Module state ──────────────────────────────────────────────────────────
let watchId = null, lastLat = null, lastLng = null, lastWrittenAt = null;
let heartbeatTimer = null, watchdogTimer = null, lastCallbackAt = null;
let wakeLock = null, activeTechId = null, activeClientId = null;
let isTracking = false, isStationary = false, stationaryStart = null;
let lastGpsError = null;

// In-memory offline queue (spec: IndexedDB with 200-entry cap).
// In-memory is sufficient for most network blips; IndexedDB persistence is a post-launch upgrade.
let offlineQueue = []; // each entry: [lat, lng, accuracy, heading, speedKmh, nonJobStatus, recordedAt]

async function flushOfflineQueue() {
  if (!activeTechId || !activeClientId || offlineQueue.length === 0) return;
  const toFlush = offlineQueue.splice(0, offlineQueue.length);
  for (let i = 0; i < toFlush.length; i++) {
    try {
      const [lat, lng, accuracy, heading, speedKmh, nonJobStatus, recordedAt] = toFlush[i];
      const { error } = await supabase.rpc('upsert_tech_location', {
        p_technician_id:  activeTechId,
        p_client_id:      activeClientId,
        p_lat:            lat, p_lng: lng, p_accuracy: accuracy,
        p_heading:        heading, p_speed_kmh: speedKmh,
        p_non_job_status: nonJobStatus, p_recorded_at: recordedAt,
      });
      if (error) throw error;
    } catch {
      offlineQueue.unshift(...toFlush.slice(i));
      break;
    }
  }
}

function _onReconnect() {
  flushOfflineQueue().catch(() => {});
}

async function writeLocation(lat, lng, accuracy, heading, speedKmh, nonJobStatus, recordedAt) {
  try {
    const { error } = await supabase.rpc('upsert_tech_location', {
      p_technician_id:  activeTechId,
      p_client_id:      activeClientId,
      p_lat:            lat,
      p_lng:            lng,
      p_accuracy:       accuracy ?? null,
      p_heading:        heading ?? null,
      p_speed_kmh:      speedKmh ?? null,
      p_non_job_status: nonJobStatus ?? null,
      p_recorded_at:    recordedAt,
    });
    if (error) throw error;
    lastLat = lat; lastLng = lng; lastWrittenAt = Date.now();
    // Flush any queued fixes now that we're back online
    if (offlineQueue.length > 0) flushOfflineQueue().catch(() => {});
  } catch (err) {
    console.error('[locationService] write failed, queuing:', err.message);
    if (offlineQueue.length < MAX_QUEUE) {
      offlineQueue.push([lat, lng, accuracy, heading, speedKmh, nonJobStatus, recordedAt]);
    }
  }
}

function handlePosition(pos) {
  if (!isTracking) return;
  lastCallbackAt = Date.now();
  const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
  const speedKmh = speed != null ? speed * 3.6 : null;
  const recordedAt = new Date(pos.timestamp).toISOString();

  if (!isSaneSpeed(speedKmh)) return;

  if (speedKmh !== null && speedKmh < STATIONARY_SPEED_KMH) {
    if (!stationaryStart) stationaryStart = Date.now();
    if (Date.now() - stationaryStart > HEARTBEAT_INTERVAL_MS) isStationary = true;
  } else {
    stationaryStart = null;
    if (isStationary) { isStationary = false; _registerWatch(true); }
  }

  const isForced = lastWrittenAt === null || Date.now() - lastWrittenAt > HEARTBEAT_INTERVAL_MS;
  if (!isForced && !shouldWriteLocation(lastLat, lastLng, lat, lng)) return;
  writeLocation(lat, lng, accuracy, heading, speedKmh, null, recordedAt);
}

function handlePositionError(err) {
  console.warn('[locationService] GPS error:', err.code, err.message);
  lastGpsError = err.message;
  if (err.code === 3 && !isStationary) _registerWatch(false); // TIMEOUT → low accuracy fallback
}

function _registerWatch(highAccuracy) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  // No timeout: Chrome Android silently hangs watchPosition when a finite timeout is set.
  // The watchdog timer (45s silence threshold) handles re-registration if GPS goes quiet.
  watchId = navigator.geolocation.watchPosition(
    handlePosition, handlePositionError,
    { enableHighAccuracy: highAccuracy, maximumAge: GPS_MAX_AGE_MS }
  );
}

const locationService = {
  getStatus() {
    return {
      isTracking,
      hasPosition: lastLat !== null,
      lastWrittenAt,
      lastError: lastGpsError,
    };
  },

  async startTracking(techId, clientId) {
    if (!navigator?.geolocation) { console.warn('[locationService] Geolocation not available'); return; }
    if (isTracking) locationService.stopTracking();

    activeTechId = techId; activeClientId = clientId;
    isTracking = true; lastLat = null; lastLng = null; lastWrittenAt = null;
    lastCallbackAt = Date.now(); isStationary = false; stationaryStart = null;

    _registerWatch(true);

    // Warmup: get an immediate first fix via getCurrentPosition (works on Android where
    // watchPosition with a timeout silently hangs before the first callback fires).
    navigator.geolocation.getCurrentPosition(
      handlePosition,
      (err) => console.warn('[locationService] warmup getCurrentPosition failed:', err.code, err.message),
      { enableHighAccuracy: true, maximumAge: GPS_MAX_AGE_MS, timeout: GPS_TIMEOUT_MS }
    );

    window.addEventListener('online', _onReconnect);

    // iOS watchdog: re-register if callbacks go silent >45s
    watchdogTimer = setInterval(() => {
      if (!isTracking) return;
      if (lastCallbackAt && Date.now() - lastCallbackAt > WATCHDOG_SILENCE_THRESHOLD_MS) {
        console.warn('[locationService] iOS watchdog: re-registering GPS');
        _registerWatch(!isStationary);
      }
    }, WATCHDOG_INTERVAL_MS);

    // 60s heartbeat: force write even when stationary
    heartbeatTimer = setInterval(() => {
      if (!isTracking || lastLat === null) return;
      if (Date.now() - (lastWrittenAt ?? 0) > HEARTBEAT_TRIGGER_THRESHOLD_MS) {
        writeLocation(lastLat, lastLng, null, null, null, null, new Date().toISOString());
      }
    }, HEARTBEAT_INTERVAL_MS);

    try { wakeLock = await navigator.wakeLock?.request('screen'); }
    catch (e) { console.warn('[locationService] WakeLock unavailable:', e.message); }
  },

  stopTracking() {
    flushOfflineQueue().catch(() => {});
    isTracking = false;
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (watchdogTimer)  { clearInterval(watchdogTimer);  watchdogTimer  = null; }
    window.removeEventListener('online', _onReconnect);
    wakeLock?.release().catch(() => {});
    wakeLock = null; activeTechId = null; activeClientId = null;
  },
};

export default locationService;
