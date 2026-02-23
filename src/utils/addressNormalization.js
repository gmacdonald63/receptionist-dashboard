/**
 * Address and phone normalization utilities.
 * Used for customer deduplication and display in the HVAC receptionist dashboard.
 */

// USPS street suffix abbreviation table (full word → canonical abbreviation, uppercase)
const STREET_SUFFIX_MAP = {
  'alley': 'ALY', 'aly': 'ALY',
  'avenue': 'AVE', 'ave': 'AVE',
  'boulevard': 'BLVD', 'blvd': 'BLVD',
  'circle': 'CIR', 'cir': 'CIR',
  'court': 'CT', 'ct': 'CT',
  'cove': 'CV', 'cv': 'CV',
  'crossing': 'XING', 'xing': 'XING',
  'drive': 'DR', 'dr': 'DR',
  'expressway': 'EXPY', 'expy': 'EXPY',
  'freeway': 'FWY', 'fwy': 'FWY',
  'highway': 'HWY', 'hwy': 'HWY',
  'lane': 'LN', 'ln': 'LN',
  'loop': 'LOOP',
  'parkway': 'PKWY', 'pkwy': 'PKWY',
  'place': 'PL', 'pl': 'PL',
  'plaza': 'PLZ', 'plz': 'PLZ',
  'road': 'RD', 'rd': 'RD',
  'route': 'RTE', 'rte': 'RTE',
  'square': 'SQ', 'sq': 'SQ',
  'street': 'ST', 'st': 'ST',
  'terrace': 'TER', 'ter': 'TER',
  'trail': 'TRL', 'trl': 'TRL',
  'turnpike': 'TPKE', 'tpke': 'TPKE',
  'way': 'WAY',
};

// USPS directional abbreviation table
const DIRECTIONAL_MAP = {
  'north': 'N', 'south': 'S', 'east': 'E', 'west': 'W',
  'northeast': 'NE', 'northwest': 'NW', 'southeast': 'SE', 'southwest': 'SW',
  'ne': 'NE', 'nw': 'NW', 'se': 'SE', 'sw': 'SW',
};

// Unit designator normalization
const UNIT_DESIGNATOR_MAP = {
  'apartment': 'APT', 'apt': 'APT',
  'suite': 'STE', 'ste': 'STE',
  'unit': 'UNIT',
  'floor': 'FL', 'fl': 'FL',
  'building': 'BLDG', 'bldg': 'BLDG',
  'department': 'DEPT', 'dept': 'DEPT',
  'room': 'RM', 'rm': 'RM',
  'space': 'SPC', 'spc': 'SPC',
  'lot': 'LOT',
};

// Tokens that stay uppercase in display form
const ALWAYS_UPPERCASE_TOKENS = new Set([
  'NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W',
  'APT', 'STE', 'UNIT', 'FL', 'BLDG', 'DEPT', 'RM', 'SPC', 'LOT',
  'ALY', 'AVE', 'BLVD', 'CIR', 'CT', 'CV', 'DR', 'EXPY', 'FWY',
  'HWY', 'LN', 'LOOP', 'PKWY', 'PL', 'PLZ', 'RD', 'RTE', 'SQ',
  'ST', 'TER', 'TRL', 'TPKE', 'WAY', 'XING',
  // US state abbreviations
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
  'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
  'TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

/**
 * Normalizes an address to a canonical uppercase form for deduplication matching.
 * Two addresses referring to the same location will produce identical output.
 * NOT for display — use normalizeForDisplay() for human-readable output.
 *
 * @param {string|null|undefined} address
 * @returns {string}
 */
export function normalizeAddress(address) {
  if (address == null || typeof address !== 'string') return '';
  let s = address.trim();
  if (!s || s.length < 3) return s.toUpperCase();
  if (/^\d+$/.test(s)) return s; // pure zip/number passthrough

  s = s.toUpperCase();
  s = s.replace(/[.,#'"]/g, '');
  s = s.replace(/\s+/g, ' ').trim();

  const tokens = s.split(' ');
  const result = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (UNIT_DESIGNATOR_MAP[lower]) { result.push(UNIT_DESIGNATOR_MAP[lower]); continue; }
    if (DIRECTIONAL_MAP[lower])     { result.push(DIRECTIONAL_MAP[lower]);     continue; }
    if (STREET_SUFFIX_MAP[lower])   { result.push(STREET_SUFFIX_MAP[lower]);   continue; }
    result.push(token);
  }
  return result.join(' ').trim();
}

/**
 * Produces a human-readable display address (Title Case, standard abbreviations).
 * @param {string|null|undefined} address
 * @returns {string}
 */
export function normalizeForDisplay(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return '';
  return normalized
    .split(' ')
    .map(token => {
      if (ALWAYS_UPPERCASE_TOKENS.has(token)) return token;
      if (/^\d/.test(token)) return token;
      return token.charAt(0) + token.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Strips all non-digit characters from a phone number for matching.
 * Strips leading country code 1 from US 11-digit numbers.
 * @param {string|null|undefined} phone
 * @returns {string}
 */
export function normalizePhone(phone) {
  if (phone == null || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

/**
 * Filters customers by name (substring) or phone (digits-only match).
 * @param {Array} customers
 * @param {string} query
 * @returns {Array}
 */
export function filterCustomers(customers, query) {
  if (!query?.trim()) return customers;
  const q = query.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  return customers.filter(customer => {
    if (customer.name?.toLowerCase().includes(q)) return true;
    if (qDigits.length >= 3) {
      const custDigits = normalizePhone(customer.phone);
      if (custDigits && custDigits.includes(qDigits)) return true;
    }
    return false;
  });
}

/**
 * Builds a partial update object with only fields where incoming is non-empty
 * and existing is empty (never overwrites). Address: longer string wins.
 */
export function buildMergePatch(existing, incoming) {
  const patch = {};
  if (!existing.name && incoming.name) patch.name = incoming.name;
  if (!existing.phone && incoming.phone) patch.phone = incoming.phone;
  if (!existing.address && incoming.address) {
    patch.address = incoming.address;
  } else if (existing.address && incoming.address) {
    if (incoming.address.length > existing.address.length) patch.address = incoming.address;
  }
  return patch;
}

/**
 * Syncs customer records from appointments only (not call logs).
 * Uses phone as primary dedup key, address as secondary.
 * Never auto-applies tags. Non-destructive merge on existing records.
 *
 * @param {Array} appointments
 * @param {Array} existingCustomers
 * @param {string} clientId
 * @param {Object} supabase
 * @returns {Promise<{ created: number, updated: number, errors: Array }>}
 */
export async function syncCustomersFromAppointments(
  appointments,
  existingCustomers,
  clientId,
  supabase
) {
  const stats = { created: 0, updated: 0, errors: [] };
  if (!appointments?.length || !clientId) return stats;

  // Build lookup indexes
  const phoneIndex = new Map();
  const addressIndex = new Map();
  for (const c of existingCustomers ?? []) {
    const np = normalizePhone(c.phone);
    if (np) phoneIndex.set(np, c);
    const na = normalizeAddress(c.address);
    if (na) addressIndex.set(na, c);
  }

  const seenThisSync = new Map();

  for (const appt of appointments) {
    const rawName    = appt.name?.trim()    || appt.caller_name?.trim()   || '';
    const rawPhone   = appt.phone?.trim()   || appt.caller_number?.trim() || '';
    const rawAddress = appt.address?.trim() || '';

    if (!rawName && !rawPhone && !rawAddress) continue;

    const normPhone = normalizePhone(rawPhone);
    const normAddr  = normalizeAddress(rawAddress);
    const syncKey   = normPhone || normAddr || rawName.toLowerCase();
    if (syncKey && seenThisSync.has(syncKey)) continue;
    if (syncKey) seenThisSync.set(syncKey, true);

    // Find most recent appointment date for last_appointment_date field.
    // For name-only records (no phone, no address), use only this appointment's
    // own date — filtering by empty normAddr would match every unaddressed record.
    let latestDate = appt.date ?? null;
    if (normPhone) {
      latestDate = appointments
        .filter(a => normalizePhone(a.phone || a.caller_number) === normPhone)
        .map(a => a.date).filter(Boolean).sort().reverse()[0] ?? null;
    } else if (normAddr) {
      latestDate = appointments
        .filter(a => normalizeAddress(a.address) === normAddr)
        .map(a => a.date).filter(Boolean).sort().reverse()[0] ?? null;
    }

    let existing = null;
    if (normPhone) existing = phoneIndex.get(normPhone) ?? null;
    if (!existing && normAddr) existing = addressIndex.get(normAddr) ?? null;

    if (existing) {
      const patch = buildMergePatch(existing, { name: rawName, phone: rawPhone, address: rawAddress });
      if (latestDate && (!existing.last_appointment_date || latestDate > existing.last_appointment_date)) {
        patch.last_appointment_date = latestDate;
      }
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase.from('customers').update(patch)
        .eq('id', existing.id).eq('client_id', clientId);
      if (error) stats.errors.push({ type: 'UPDATE_FAILED', id: existing.id, message: error.message });
      else {
        stats.updated++;
        const merged = { ...existing, ...patch };
        if (normPhone) phoneIndex.set(normPhone, merged);
        if (normAddr) addressIndex.set(normAddr, merged);
      }
    } else {
      const { data: inserted, error } = await supabase.from('customers').insert({
        client_id: clientId,
        name: rawName || null,
        phone: rawPhone || null,
        email: null,
        address: rawAddress || null,
        tags: [],
        last_appointment_date: latestDate,
      }).select().single();
      if (error) {
        stats.errors.push({ type: error.code === '23505' ? 'DUPLICATE_ON_INSERT' : 'INSERT_FAILED', message: error.message });
      } else {
        stats.created++;
        if (normPhone) phoneIndex.set(normPhone, inserted);
        const na2 = normalizeAddress(inserted.address);
        if (na2) addressIndex.set(na2, inserted);
      }
    }
  }
  return stats;
}
