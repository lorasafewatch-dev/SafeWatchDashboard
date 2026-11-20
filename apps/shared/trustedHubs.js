import { isValidGpsPoint } from './gpsStatus.js';
import { familyZoneContains } from './familySafeZone.js';
import { withRequestTimeout } from './requestTimeout.js';

export const MIN_LOCATION_RADIUS = 10;
export const MAX_LOCATION_RADIUS = 5000;

export function safeLocationsForWatch(locations, watchId) {
  return locations.filter(location => !location.device_id || location.device_id === watchId);
}

export function safeLocationAt(point, locations = []) {
  return locations.find(location => familyZoneContains(point, location)) ?? null;
}

export function validateSafeLocation(draft) {
  const name = String(draft.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) throw new Error('Enter a safe location name of up to 80 characters.');
  const number = value => value == null || value === '' ? NaN : Number(value);
  const lat = number(draft.lat);
  const lng = number(draft.lng);
  const radius = number(draft.radius);
  if (!isValidGpsPoint({ lat, lng })) throw new Error('Choose a point on the map or enter its coordinates.');
  if (!Number.isInteger(radius) || radius < MIN_LOCATION_RADIUS || radius > MAX_LOCATION_RADIUS) throw new Error('Choose a whole-number radius from 10 to 5,000 meters.');
  return { name, lat, lng, radius };
}

export async function loadTrustedHubs(client) {
  const { data, error } = await withRequestTimeout(client.from('trusted_hubs')
    .select('id,device_id,name,lat,lng,radius,revision').order('name').order('id'), 5000, 'Loading safe locations took too long.');
  if (error) throw error;
  return data ?? [];
}

const writeTimeout = 'Saving the safe location took too long.';
function canRetry(error) {
  return error?.message === writeTimeout || /load failed|failed to fetch|network\s?error/i.test(error?.message || '')
    || ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].includes(error?.code)
    || [408, 502, 503, 504].includes(error?.status);
}

export async function saveSafeLocation(client, record, deleting = false) {
  const location = deleting ? null : validateSafeLocation(record);
  const payload = { p_id: record.id, p_device_id: record.device_id ?? null, p_location: location, p_expected: record.revision ?? null };
  const attempt = async () => {
    const { data, error } = await withRequestTimeout(client.rpc('save_safewatch_safe_location', payload), 6500, writeTimeout);
    if (error) throw error;
    return data;
  };
  let data;
  try { data = await attempt(); }
  catch (error) {
    if (!canRetry(error)) throw error;
    // The server may have committed before the response was lost. Reuse the
    // same ID and revision so retrying cannot add a second circle.
    data = await attempt();
  }
  if (!data || !record.id || data.id !== record.id || (data.device_id ?? null) !== payload.p_device_id || (deleting
    ? data.deleted !== true : (!data.revision || Object.keys(location).some(key => location[key] !== data[key])))) {
    throw new Error('The safe location change could not be verified. Reload the map and retry.');
  }
  return deleting ? null : data;
}

export function safeLocationError(error) {
  if (canRetry(error)) return 'Connection interrupted. Reconnect and try again.';
  if (error?.code === '40001') return 'This location changed in another session. Close and reopen the editor to use the latest settings.';
  if (error?.code === '42501') return 'Your account no longer has access to change this location.';
  return error?.message || 'The safe location could not be saved. Please try again.';
}
