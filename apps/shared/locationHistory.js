import { isValidGpsPoint } from './gpsStatus.js';

export const HISTORY_PAGE_SIZE = 200;
export const HISTORY_GAP_MS = 5 * 60 * 1000;
export const manilaDate = (now = Date.now()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(now));

export function historyDayRange(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Choose a valid date.');
  const start = new Date(`${day}T00:00:00+08:00`);
  if (!Number.isFinite(start.getTime()) || manilaDate(start) !== day) throw new Error('Choose a valid date.');
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}

export async function loadLocationHistory(client, deviceId, day, cursor = null) {
  const range = historyDayRange(day);
  const { data, error } = await client.rpc('get_watch_location_history', {
    p_device_id: deviceId, p_start: range.start, p_end: range.end,
    p_before_at: cursor?.observed_at ?? null, p_before_id: cursor?.telemetry_id ?? null,
    p_limit: HISTORY_PAGE_SIZE + 1,
  });
  if (error) throw error;
  const rows = data || [];
  // Cursor follows raw rows even if a malformed observation is discarded.
  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  return { points: page.filter(row => isValidGpsPoint(row) && Number.isFinite(Date.parse(row.observed_at))),
    hasMore: rows.length > HISTORY_PAGE_SIZE, cursor: page.at(-1) || null };
}

export function historySegments(points) {
  const ordered = [...points].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const segments = [];
  for (const point of ordered) {
    const segment = segments.at(-1);
    const previous = segment?.at(-1);
    if (!previous || Date.parse(point.observed_at) - Date.parse(previous.observed_at) > HISTORY_GAP_MS) segments.push([point]);
    else segment.push(point);
  }
  return segments;
}

export function locationHistoryError(error) {
  if (['PGRST202', '42883'].includes(error?.code)) return 'Location history needs the SafeWatch database update.';
  if (['42501', 'PGRST301'].includes(error?.code)) return 'Access to this watch is unavailable. Refresh your watches or sign in again.';
  return 'Location history could not be loaded. Check your connection and retry.';
}
