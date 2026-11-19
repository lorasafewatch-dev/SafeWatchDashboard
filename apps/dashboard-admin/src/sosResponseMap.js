import { needsBarangayAttention } from '../../shared/alertLifecycle.js';
import { isCurrentGpsPoint, isValidGpsPoint } from '../../shared/gpsStatus.js';
import { DEFAULT_SAFE_ZONE_NAME, validateFamilySafeZone } from '../../shared/familySafeZone.js';

export function isPendingSos(incident) {
  return incident?.alert_type === 'SOS' && incident.details?.incident_open !== false
    && ['PENDING_FAMILY', 'ESCALATED_BHW'].includes(incident.details?.status || 'PENDING_FAMILY');
}

export function isAcknowledgedSos(incident) {
  return incident?.alert_type === 'SOS' && ['ACKNOWLEDGED_FAMILY', 'ACKNOWLEDGED_BHW'].includes(incident.details?.status);
}

export function showAdminIncident(incident, now) {
  // SOS is visible upon receipt; geofence and battery alerts keep their own rules.
  return incident.alert_type === 'SOS' ? isPendingSos(incident) : needsBarangayAttention(incident, now);
}

export function responseMapIncidents(active, responses, selected) {
  const records = new Map();
  for (const incident of [...responses, ...active]) {
    if (incident.alert_type === 'SOS') records.set(String(incident.id), incident);
  }
  if (selected?.alert_type === 'SOS' && !records.has(String(selected.id))) records.set(String(selected.id), selected);
  return [...records.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
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
