import { isCurrentGpsPoint, isValidGpsPoint, telemetryTimestamp } from './gpsStatus.js';

// Supabase geography is usually EWKB hex. Also accept WKT and GeoJSON points.
export function parseGpsPoint(location) {
  let point = null;
  if (location?.type === 'Point' && Array.isArray(location.coordinates)) {
    point = { lng: location.coordinates[0], lat: location.coordinates[1] };
  } else if (typeof location === 'string') {
    const wkt = location.match(/^(?:SRID=4326;)?POINT\s*\(\s*([-+\d.eE]+)\s+([-+\d.eE]+)\s*\)$/i);
    if (wkt) point = { lng: Number(wkt[1]), lat: Number(wkt[2]) };
    else {
      const hex = location.replace(/^\\x/, '');
      if (hex.length < 42 || hex.length % 2 || !/^[\da-f]+$/i.test(hex)) return null;
      const bytes = Uint8Array.from(hex.match(/../g), value => parseInt(value, 16));
      const view = new DataView(bytes.buffer);
      if (bytes[0] !== 0 && bytes[0] !== 1) return null;
      const littleEndian = bytes[0] === 1;
      const type = view.getUint32(1, littleEndian);
      if ((type & 0xffff) !== 1) return null;
      const offset = (type & 0x20000000) ? 9 : 5;
      if (bytes.length < offset + 16) return null;
      if ((type & 0x20000000) && view.getUint32(5, littleEndian) !== 4326) return null;
      point = { lng: view.getFloat64(offset, littleEndian), lat: view.getFloat64(offset + 8, littleEndian) };
    }
  }
  return isValidGpsPoint(point) ? point : null;
}

export function gpsObservation(record) {
  const point = parseGpsPoint(record?.location);
  const observedAt = telemetryTimestamp(record);
  return point && Number.isFinite(Date.parse(observedAt)) ? { point, observedAt } : null;
}

// A delayed cloud insert must not move the retained marker back in time.
export function retainGpsObservation(previous, incoming) {
  if (!incoming) return previous || null;
  return !previous || Date.parse(incoming.observedAt) >= Date.parse(previous.observedAt)
    ? incoming : previous;
}

export async function loadLastGpsObservation(client, deviceId) {
  const { data, error } = await client.from('telemetry').select('*')
    .eq('device_id', deviceId)
    // SQL <> also excludes NULL, so a single filter skips all no-fix packets.
    .neq('location', 'SRID=4326;POINT(0 0)')
    .order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  return (data || []).reduce((last, record) => retainGpsObservation(last, gpsObservation(record)), null);
}

export function isLiveFamilyLocation(senior, now = Date.now()) {
  return !!senior.latestHasGpsFix && isCurrentGpsPoint(senior.position, senior.positionAt, now);
}

// Expire a dashboard fix even if a failed refresh leaves the previous row in memory.
export function dashboardLocationAt(senior, now = Date.now()) {
  if (!senior.hasGpsLock || isCurrentGpsPoint({lat:senior.lat,lng:senior.lng}, senior.positionAt, now)) return senior;
  return {...senior, hasGpsLock:false, type:senior.isSOS?'sos':'waiting',
    status:senior.isSOS?'SOS ALERT!':'No current GPS fix', location:'No current GPS fix'};
}

export function locationAge(timestamp, now = Date.now()) {
  const age = now - Date.parse(timestamp);
  if (!Number.isFinite(age)) return 'Unknown';
  const seconds = Math.max(0, Math.floor(age / 1000));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
}
