import { isValidGpsPoint } from './gpsStatus.js';
import { isInsidePolygon, SAN_ISIDRO_EAST_BOUNDARY } from './safeZone.js';
import { normalizeWatchId } from './familySeniors.js';

export const MIN_SAFE_ZONE_RADIUS = 50;
export const MAX_SAFE_ZONE_RADIUS = 5000;
export const DEFAULT_SAFE_ZONE_NAME = 'San Isidro East';
// Matches Leaflet's circle measurement and the server's spherical distance.
const EARTH_RADIUS = 6371000;

export function validateFamilySafeZone(draft) {
  const name = String(draft?.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) throw new Error('Enter a safe-zone name, up to 80 characters.');
  const number = value => value === '' || value == null ? NaN : Number(value);
  const lat = number(draft?.lat);
  const lng = number(draft?.lng);
  if (!isValidGpsPoint({ lat, lng })) throw new Error('Choose a valid center on the map or enter its coordinates.');
  const radius = number(draft?.radius);
  if (!Number.isInteger(radius) || radius < MIN_SAFE_ZONE_RADIUS || radius > MAX_SAFE_ZONE_RADIUS) {
    throw new Error('Choose a radius from 50 to 5,000 meters, using whole numbers.');
  }
  return { name, lat, lng, radius };
}

export function familyZoneContains(point, zone) {
  if (!isValidGpsPoint(point)) return false;
  if (!zone) return isInsidePolygon(point.lat, point.lng);
  const toRadians = degrees => degrees * Math.PI / 180;
  const a = Math.sin(toRadians(point.lat - zone.lat) / 2) ** 2
    + Math.cos(toRadians(zone.lat)) * Math.cos(toRadians(point.lat))
    * Math.sin(toRadians(point.lng - zone.lng) / 2) ** 2;
  const distance = EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
  return distance <= zone.radius;
}

export function familyZoneBounds(zone) {
  if (!zone) return SAN_ISIDRO_EAST_BOUNDARY;
  const latDelta = zone.radius / EARTH_RADIUS * 180 / Math.PI;
  const lngDelta = Math.min(180, latDelta / Math.max(.000001, Math.cos(zone.lat * Math.PI / 180)));
  return [[Math.max(-90, zone.lat - latDelta), zone.lng - lngDelta],
    [Math.min(90, zone.lat + latDelta), zone.lng + lngDelta]];
}

export async function saveFamilySafeZone(client, deviceId, draft, expectedZone) {
  const id = normalizeWatchId(deviceId);
  const zone = draft === null ? null : validateFamilySafeZone(draft);
  const { data, error } = await client.rpc('save_family_safe_zone', {
    p_device_id: id, p_zone: zone, p_expected_zone: expectedZone ?? null,
  });
  if (error) throw error;
  if (!data || data.device_id !== id || !Object.hasOwn(data, 'zone')) {
    throw new Error('The saved safe zone could not be verified. Refresh and try again.');
  }
  if ((zone && (!data.zone?.revision || JSON.stringify(validateFamilySafeZone(data.zone)) !== JSON.stringify(zone)))
      || (!zone && data.zone !== null)) {
    throw new Error('The saved safe zone could not be verified. Refresh and try again.');
  }
  return data.zone;
}

export function safeZoneErrorMessage(error) {
  if (error?.code === '40001') return 'Another family member changed this safe zone. Cancel and reopen the editor to load their changes.';
  if (error?.code === '42501') return 'Your family account must still be linked to this senior to change their safe zone.';
  if (['PGRST202', '42883'].includes(error?.code)) return 'Safe-zone saving is not available yet. Please contact the system administrator.';
  return error?.message || 'The safe zone could not be saved. Check your connection and try again.';
}
