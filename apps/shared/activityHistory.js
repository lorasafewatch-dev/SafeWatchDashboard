import { historyDayRange } from './locationHistory.js';

export const ACTIVITY_PAGE_SIZE = 100;
export async function loadActivityHistory(client, { day, deviceId = null, category = 'all', alertType = null }, cursor = null, signal) {
  const range = historyDayRange(day);
  let query = client.rpc('get_watch_activity_history', {
    p_start: range.start, p_end: range.end, p_device_id: deviceId || null,
    p_category: category, p_alert_type: category === 'alerts' ? alertType || null : null,
    p_before_at: cursor?.occurred_at ?? null, p_before_id: cursor?.event_id ?? null,
    p_limit: ACTIVITY_PAGE_SIZE + 1,
  });
  if (signal && query.abortSignal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
  return { records: page, cursor: page.at(-1) || null, hasMore: rows.length > ACTIVITY_PAGE_SIZE };
}

export function activityHistoryError(error) {
  if (['PGRST202','42883','42P01'].includes(error?.code)) return 'Activity history needs the SafeWatch database update.';
  if (['42501','PGRST301'].includes(error?.code)) return 'Access is unavailable. Refresh your watches or sign in again.';
  return 'Activity history could not be loaded. Check your connection and retry.';
}

const kinds = {
  alert_opened: 'Alert recorded', alert_snapshot: 'Existing alert record', sos_response: 'SOS response saved',
  alert_confirmed: 'Alert confirmed', alert_closed: 'Alert closed', alert_changed: 'Alert status changed',
  location_recorded: 'GPS location recorded', watch_registered: 'Watch registered', profile_updated: 'Senior profile updated',
  safe_zone_updated: 'Safe zone updated', safe_zone_removed: 'Safe zone removed',
  family_safe_zone_updated: 'Family safe zone updated', family_safe_zone_removed: 'Family safe zone removed',
  family_access_approve: 'Family access approved', family_access_reject: 'Family access rejected',
  family_access_revoked: 'Family access revoked', delete_senior_watch: 'Senior and watch deleted',
  initialize_super_admin: 'Administrator initialized', transfer_super_admin: 'Administrator transferred',
  approve: 'Account approved', reject: 'Account rejected', suspend: 'Account suspended',
};
const statuses = { PENDING_FAMILY: 'Awaiting family response', ESCALATED_BHW: 'Barangay attention required',
  ACKNOWLEDGED_FAMILY: 'Confirmed by family', ACKNOWLEDGED_BHW: 'Confirmed by barangay', RESOLVED: 'Resolved' };
export const activityTitle = record => kinds[record.event_kind] || record.event_kind?.replaceAll('_', ' ') || 'System event';
export const activityStatus = record => {
  const status = statuses[record.status] || record.status || '';
  return record.details?.incident_open === false ? [status, 'Closed'].filter(Boolean).join(' · ') : status;
};
export const activityAlertTitle = type => ({ SOS: 'SOS', GEOFENCE: 'Geofence', LOW_BATTERY: 'Low battery' })[type] || type || '';
