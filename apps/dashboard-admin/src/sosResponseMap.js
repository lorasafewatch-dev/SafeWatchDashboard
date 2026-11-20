import { needsBarangayAttention } from '../../shared/alertLifecycle.js';
import { isCurrentGpsPoint, isValidGpsPoint } from '../../shared/gpsStatus.js';
import { DEFAULT_SAFE_ZONE_NAME, validateFamilySafeZone } from '../../shared/familySafeZone.js';
import { barangaySosStage } from '../../shared/sosResponse.js';

export function isPendingSos(incident, now) {
  return incident?.alert_type === 'SOS' && incident.details?.incident_open !== false
    && needsBarangayAttention(incident, now);
}

export function isAcknowledgedSos(incident) {
  return incident?.alert_type === 'SOS' && ['ACKNOWLEDGED_FAMILY', 'ACKNOWLEDGED_BHW'].includes(incident.details?.status);
}

export function isClearableSosHistory(incident) {
  return incident?.alert_type === 'SOS' && barangaySosStage(incident) !== 'on_the_way'
    && (isAcknowledgedSos(incident) || incident.details?.incident_open === false
      || ['RESOLVED', 'MERGED'].includes(incident.details?.status));
}

export function showAdminIncident(incident, now) {
  return needsBarangayAttention(incident, now);
}

export function responseMapIncidents(active, responses, selected) {
  const candidates = [...responses, ...active, selected];
  const arrivedIds = new Set(candidates.filter(row => barangaySosStage(row) === 'arrived').map(row => String(row.id)));
  const records = new Map();
  for (const incident of [...responses, ...active]) {
    if (incident.alert_type === 'SOS' && !(incident.details?.sos_family_first === true && !incident.details.sos_transferred_at)) records.set(String(incident.id), incident);
  }
  if (selected?.alert_type === 'SOS' && !(selected.details?.sos_family_first === true && !selected.details.sos_transferred_at) && !records.has(String(selected.id))) records.set(String(selected.id), selected);
  return [...records.values()].filter(row => !arrivedIds.has(String(row.id)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function responseMapZone(senior) {
  if (!senior) return { zone: null, name: 'Assigned geofence unavailable', unavailable: true };
  if (!senior.safeZone) return { zone: null, name: DEFAULT_SAFE_ZONE_NAME, unavailable: false };
  try { const zone = validateFamilySafeZone(senior.safeZone); return { zone, name: zone.name, unavailable: false }; }
  catch { return { zone: null, name: 'Assigned geofence unavailable', unavailable: true }; }
}

export function responseMapPositions(incident, observation, now = Date.now()) {
  const snapshot = incident?.details?.sos_location;
  const sos = isValidGpsPoint(snapshot?.point) ? { point: snapshot.point, observedAt: snapshot.recorded_at } : null;
  const time = Date.parse(observation?.observedAt);
  const latest = isValidGpsPoint(observation?.point) && Number.isFinite(time) && time <= now + 5000 ? observation : null;
  return { sos, latest, live: !!latest && isCurrentGpsPoint(latest.point, latest.observedAt, now) };
}
