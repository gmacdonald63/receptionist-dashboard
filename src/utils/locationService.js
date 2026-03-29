// src/utils/locationService.js
import { supabase } from '../supabaseClient.js';

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
  return haversineMeters(lastLat, lastLng, newLat, newLng) >= 50;
}

export function isSaneSpeed(speedKmh) {
  if (speedKmh === null || speedKmh === undefined) return true;
  return speedKmh <= 200;
}

// ── Module state ──────────────────────────────────────────────────────────
let watchId = null, lastLat = null, lastLng = null, lastWrittenAt = null;
let heartbeatTimer = null, watchdogTimer = null, lastCallbackAt = null;
let wakeLock = null, activeTechId = null, activeClientId = null;
let isTracking = false, isStationary = false, stationaryStart = null;

// In-memory offline queue (spec: IndexedDB with 200-entry cap).
// In-memory is sufficient for most network blips; IndexedDB persistence is a post-launch upgrade.
const MAX_QUEUE = 200;
let offlineQueue = []; // each entry: [lat, lng, accuracy, heading, speedKmh, nonJobStatus, recordedAt]

async function flushOfflineQueue() {
  if (offlineQueue.length === 0) return;
  const toFlush = offlineQueue.splice(0); // take all and clear
  for (const args of toFlush) {
    try {
      const { error } = await supabase.rpc('upsert_tech_location', {
        p_technician_id:  activeTechId,
        p_client_id:      activeClientId,
        p_lat:            args[0], p_lng: args[1], p_accuracy: args[2],
        p_heading:        args[3], p_speed_kmh: args[4],
        p_non_job_status: args[5], p_recorded_at: args[6],
      });
      if (error) throw error;
    } catch {
      offlineQueue.unshift(...toFlush.slice(toFlush.indexOf(args))); // re-queue remaining on fail
      break;
    }
  }
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

  if (speedKmh !== null && speedKmh < 3) {
    if (!stationaryStart) stationaryStart = Date.now();
    if (Date.now() - stationaryStart > 60000) isStationary = true;
  } else {
    stationaryStart = null;
    if (isStationary) { isStationary = false; _registerWatch(true); }
  }

  const isForced = lastWrittenAt === null || Date.now() - lastWrittenAt > 60000;
  if (!isForced && !shouldWriteLocation(lastLat, lastLng, lat, lng)) return;
  writeLocation(lat, lng, accuracy, heading, speedKmh, null, recordedAt);
}

function handlePositionError(err) {
  console.warn('[locationService] GPS error:', err.code, err.message);
  if (err.code === 3 && !isStationary) _registerWatch(false); // TIMEOUT → low accuracy fallback
}

function _registerWatch(highAccuracy) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    handlePosition, handlePositionError,
    { enableHighAccuracy: highAccuracy, maximumAge: 15000, timeout: 10000 }
  );
}

const locationService = {
  async startTracking(techId, clientId) {
    if (!navigator?.geolocation) { console.warn('[locationService] Geolocation not available'); return; }
    if (isTracking) locationService.stopTracking();

    activeTechId = techId; activeClientId = clientId;
    isTracking = true; lastLat = null; lastLng = null; lastWrittenAt = null;
    lastCallbackAt = Date.now(); isStationary = false; stationaryStart = null;

    _registerWatch(true);

    // iOS watchdog: re-register if callbacks go silent >45s
    watchdogTimer = setInterval(() => {
      if (!isTracking) return;
      if (lastCallbackAt && Date.now() - lastCallbackAt > 45000) {
        console.warn('[locationService] iOS watchdog: re-registering GPS');
        _registerWatch(!isStationary);
      }
    }, 30000);

    // 60s heartbeat: force write even when stationary
    heartbeatTimer = setInterval(() => {
      if (!isTracking || lastLat === null) return;
      if (Date.now() - (lastWrittenAt ?? 0) > 55000) {
        writeLocation(lastLat, lastLng, null, null, null, null, new Date().toISOString());
      }
    }, 60000);

    try { wakeLock = await navigator.wakeLock?.request('screen'); }
    catch (e) { console.warn('[locationService] WakeLock unavailable:', e.message); }
  },

  stopTracking() {
    isTracking = false;
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (watchdogTimer)  { clearInterval(watchdogTimer);  watchdogTimer  = null; }
    wakeLock?.release().catch(() => {});
    wakeLock = null; activeTechId = null; activeClientId = null;
  },
};

export default locationService;
