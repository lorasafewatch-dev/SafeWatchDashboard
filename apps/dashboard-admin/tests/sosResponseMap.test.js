import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAcknowledgedSos, isPendingSos, responseMapIncidents, responseMapPositions, responseMapZone, showAdminIncident } from '../src/sosResponseMap.js';

const now = Date.parse('2026-11-19T10:00:00Z');
const incident = (id, status = 'PENDING_FAMILY') => ({ id, device_id: `watch-${id}`, alert_type: 'SOS', created_at: '2026-11-19T09:59:58Z', details: { status, incident_open: true } });
test('family-only SOS stays out of admin until transfer; non-SOS escalation rules are retained', () => {
  const sos = incident(1); sos.details.sos_assigned_to = 'family';
  sos.details.sos_family_first = true;
  assert.equal(showAdminIncident(sos, now), false);
  assert.equal(showAdminIncident(sos, now + 900000), false);
  const transferred = { ...sos, details: { ...sos.details, status: 'ESCALATED_BHW', sos_assigned_to: 'barangay', sos_transferred_at: new Date(now).toISOString() } };
  assert.equal(showAdminIncident(transferred, now), true);
  assert.equal(showAdminIncident({ ...sos, alert_type: 'GEOFENCE' }, now), false);
  assert.equal(showAdminIncident(incident(2, 'ACKNOWLEDGED_BHW'), now), false);
});
test('acknowledged and historical incidents remain selectable without duplicate alert IDs', () => {
  const sos = incident(1), acknowledged = incident(2, 'ACKNOWLEDGED_BHW'), history = incident(3, 'RESOLVED');
  const records = responseMapIncidents([sos, { ...sos, alert_type: 'LOW_BATTERY' }], [acknowledged, sos], history);
  assert.deepEqual(new Set(records.map(row => row.id)), new Set([1, 2, 3]));
  assert.equal(records.length, 3);
  assert.equal(isPendingSos(sos), true); assert.equal(isPendingSos(acknowledged), false); assert.equal(isAcknowledgedSos(acknowledged), true);
});
test('saved SOS pin stays fixed when the watch moves, and stale fixes retain their recording time', () => {
  const sos = incident(1);
  sos.details.sos_location = { point: { lat: 14.039, lng: 121.123 }, recorded_at: '2026-11-19T09:59:58Z' };
  const observation = { point: { lat: 14.041, lng: 121.125 }, observedAt: '2026-11-19T09:59:59Z' };
  const positions = responseMapPositions(sos, observation, now);
  assert.equal(positions.live, true); assert.deepEqual(positions.sos.point, { lat: 14.039, lng: 121.123 });
  assert.deepEqual(positions.latest.point, observation.point);
  assert.equal(responseMapPositions(sos, observation, now + 46000).live, false);
  assert.deepEqual(responseMapPositions(sos, observation, now + 46000).latest, observation);
});
test('invalid, zero, future and undated fixes never become location pins', () => {
  for (const observation of [null, { point: { lat: 0, lng: 0 }, observedAt: '2026-11-19T09:59:59Z' }, { point: { lat: 91, lng: 0 }, observedAt: '2026-11-19T09:59:59Z' }, { point: { lat: 14, lng: 121 }, observedAt: null }, { point: { lat: 14, lng: 121 }, observedAt: '2026-11-19T10:01:00Z' }]) {
    const result = responseMapPositions(incident(1), observation, now);
    assert.equal(result.latest, null); assert.equal(result.live, false); assert.equal(result.sos, null);
  }
});
test('the default boundary applies only to unassigned seniors; malformed or missing records are explicit', () => {
  assert.deepEqual(responseMapZone({ id: 'one', safeZone: null }), { zone: null, name: 'San Isidro East', unavailable: false });
  const assigned = { name: 'Home safe zone', lat: 14.039, lng: 121.123, radius: 300 };
  assert.deepEqual(responseMapZone({ id: 'two', safeZone: assigned }).zone, assigned);
  assert.equal(responseMapZone({ safeZone: { ...assigned, lat: NaN } }).unavailable, true);
  assert.equal(responseMapZone(null).unavailable, true);
});
