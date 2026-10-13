export const RESPONSE_WINDOW_MS = 3 * 60 * 1000;
export const REMINDER_WINDOW_MS = 30 * 1000;
// Include confirmed open incidents so an old cached identity cannot reopen them.
// Closed acknowledged history must not crowd active incidents out of the query.
export const ALERT_QUERY_FILTER = 'details->>incident_open.eq.true,details->>status.is.null,details->>status.in.(PENDING_FAMILY,ESCALATED_BHW),alert_type.in.(RESOLVE_ALL,RESOLVE_GEOFENCE)';

const activeStatuses = new Set(['PENDING_FAMILY', 'ESCALATED_BHW']);
const timestamp = value => {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
};

export function alertClock(alert, now = Date.now()) {
  const start = timestamp(alert?.details?.first_seen_at || alert?.created_at);
  const elapsedMs = start === null ? 0 : Math.max(0, now - start);
  const remainingSeconds = Math.max(0, Math.ceil((RESPONSE_WINDOW_MS - elapsedMs) / 1000));
  return { elapsedSeconds: Math.floor(elapsedMs / 1000), remainingSeconds,
    warning: remainingSeconds > 0 && remainingSeconds <= REMINDER_WINDOW_MS / 1000,
    escalated: start !== null && elapsedMs >= RESPONSE_WINDOW_MS };
}

// Old installations insert a row for every packet. Keep the first incident's
// identity/time even when that row leaves the latest query's result window.
export function groupAlertIncidents(rows = [], previous = []) {
  const watermarks = new Map();
  for (const row of rows) {
    if (!['RESOLVE_ALL', 'RESOLVE_GEOFENCE'].includes(row.alert_type)) continue;
    const key = `${row.device_id}:${row.alert_type === 'RESOLVE_ALL' ? '*' : 'GEOFENCE'}`;
    watermarks.set(key, Math.max(watermarks.get(key) || 0, timestamp(row.created_at) || 0));
  }
  const groups = new Map();
  for (const row of rows) {
    if (!['GEOFENCE', 'SOS'].includes(row.alert_type)) continue;
    if (!activeStatuses.has(row.details?.status || 'PENDING_FAMILY')) continue;
    if (row.details?.incident_open === false) continue;
    // Retain compatibility with the old geofence acknowledgement mechanism.
    // A confirmed geofence must never hide an independent SOS emergency.
    if (row.alert_type === 'GEOFENCE' && row.devices?.device_name?.includes('[MUTED]')) continue;
    const started = timestamp(row.details?.first_seen_at || row.created_at);
    if (started === null) continue;
    const watermark = Math.max(watermarks.get(`${row.device_id}:*`) || 0,
      watermarks.get(`${row.device_id}:${row.alert_type}`) || 0);
    if (started <= watermark) continue;
    const groupKey = row.details?.source === 'family_app' && row.alert_type === 'SOS'
      ? `${row.device_id}:SOS:manual:${row.id}` : `${row.device_id}:${row.alert_type}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }
  const incidents = [];
  for (const [groupKey, members] of groups) {
    members.sort((a, b) => timestamp(a.created_at) - timestamp(b.created_at) || Number(a.id) - Number(b.id));
    const first = members[0];
    const last = members.at(-1);
    let started = first.details?.first_seen_at || first.created_at;
    let rootId = first.id;
    const prior = previous.find(item => item.groupKey === groupKey);
    const boundary = Math.max(watermarks.get(`${first.device_id}:*`) || 0,
      watermarks.get(`${first.device_id}:${first.alert_type}`) || 0);
    const priorResolved = prior && rows.some(row => String(row.id) === String(prior.id)
      && (!activeStatuses.has(row.details?.status || 'PENDING_FAMILY') || row.details?.incident_open === false));
    // Explicit server incident timestamps take precedence over the legacy cache.
    if (prior && !first.details?.first_seen_at && !priorResolved
        && timestamp(prior.created_at) > boundary && timestamp(prior.created_at) <= timestamp(started)) {
      started = prior.created_at;
      rootId = prior.id;
    }
    incidents.push({ ...first, id: rootId, created_at: started, groupKey,
      key: `${groupKey}:${started}`, memberIds: members.map(row => row.id),
      devices: last.devices || first.devices,
      details: { ...first.details, ...last.details, first_seen_at: started,
        last_seen_at: last.details?.last_seen_at || last.created_at },
      updateCount: Math.max(members.length, Number(last.details?.update_count) || 1) });
  }
  return incidents.sort((a, b) => Number(b.alert_type === 'SOS') - Number(a.alert_type === 'SOS')
    || timestamp(a.created_at) - timestamp(b.created_at));
}

export function planAlertSounds(incidents, ledger = {}, now = Date.now()) {
  const nextLedger = { ...ledger };
  const events = [];
  for (const incident of incidents) {
    const clock = alertClock(incident, now);
    const entry = { ...nextLedger[incident.key] };
    if (!entry.initial) {
      events.push({ key: incident.key, tone: incident.alert_type === 'SOS' ? 'sos' : 'geofence' });
      entry.initial = true;
      // An incident first discovered in its last 30 seconds gets one sound,
      // rather than an initial tone immediately followed by another tone.
      if (clock.warning || clock.escalated) entry.reminder = true;
    } else if (clock.warning && !entry.reminder) {
      events.push({ key: incident.key, tone: 'reminder' });
      entry.reminder = true;
    }
    nextLedger[incident.key] = entry;
  }
  return { ledger: Object.fromEntries(Object.entries(nextLedger).slice(-512)), events };
}

export function incidentSnapshot(incidents) {
  return incidents.map(({ id, key, groupKey, device_id, alert_type, created_at }) =>
    ({ id, key, groupKey, device_id, alert_type, created_at }));
}

export function needsBarangayAttention(incident, now = Date.now()) {
  return activeStatuses.has(incident.details?.status || 'PENDING_FAMILY')
    && incident.details?.incident_open !== false
    && (incident.details?.status === 'ESCALATED_BHW' || alertClock(incident, now).escalated);
}

export function confirmationErrorMessage(error) {
  if (['PGRST202', '42883'].includes(error?.code)) {
    return 'Alert confirmation needs the SafeWatch database update. The alert remains active.';
  }
  if (['42501', 'PGRST301'].includes(error?.code)) {
    return 'Your session cannot save this confirmation. Please sign in again. The alert remains active.';
  }
  return 'Confirmation could not be saved. The alert remains active. Please try again.';
}

export async function acknowledgeIncident(client, incident, role = 'family') {
  if (!['family', 'barangay'].includes(role)) throw new Error('Invalid confirmation role');
  const { data, error } = await client.rpc('acknowledge_alert_incident', {
    p_alert_id: incident.id, p_role: role,
  });
  if (error) throw error;
  if (data !== true) throw new Error('This alert changed before confirmation. Refresh and try again.');
}

export async function requestFamilySos(client, deviceId) {
  const { data, error } = await client.rpc('request_family_sos', { p_device_id: deviceId });
  if (error) throw error;
  if (data == null) throw new Error('The SOS alert could not be saved.');
  return data;
}
