import test from 'node:test';
import assert from 'node:assert/strict';
import { historyDayRange, historySegments, loadLocationHistory, manilaDate } from './locationHistory.js';
import { alertTitle, batteryAlertMessage, groupAlertIncidents, needsBarangayAttention, planAlertSounds } from './alertLifecycle.js';

test('history date boundaries use Philippine midnight, including UTC year rollover', () => {
  assert.equal(manilaDate(Date.parse('2026-12-31T16:10:00Z')), '2027-01-01');
  assert.deepEqual(historyDayRange('2026-11-03'), { start: '2026-11-02T16:00:00.000Z', end: '2026-11-03T16:00:00.000Z' });
  for (const value of ['', '2026-02-30', '2026-13-01', 'not-a-date']) assert.throws(() => historyDayRange(value));
});

test('history pagination keeps timestamp/id cursor and discards invalid GPS without losing progress', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => ({ telemetry_id: String(900-i), observed_at: '2026-11-03T01:00:00Z', lat: 14.039, lng: 121.123 }));
  rows[199].lat = 0; rows[199].lng = 0;
  let args;
  const client = { rpc: async (name, parameters) => { assert.equal(name, 'get_watch_location_history'); args = parameters; return { data: rows }; } };
  const page = await loadLocationHistory(client, 'watch', '2026-11-03');
  assert.equal(page.points.length, 199); assert.equal(page.hasMore, true);
  assert.equal(page.cursor.telemetry_id, '701');
  await loadLocationHistory(client, 'watch', '2026-11-03', page.cursor);
  assert.equal(args.p_before_id, '701'); assert.equal(args.p_before_at, rows[199].observed_at);
  assert.equal(args.p_limit, 201);
});

test('failed history requests propagate errors instead of claiming no locations', async () => {
  const error = { code: '42501' };
  await assert.rejects(loadLocationHistory({ rpc: async () => ({ error }) }, 'watch', '2026-11-03'), failure => failure === error);
});

test('routes sort observations and leave gaps longer than five minutes open', () => {
  const points = [601, 0, 10, 300].map((seconds, i) => ({ telemetry_id: i, observed_at: new Date(seconds*1000).toISOString(), lat: 14, lng: 121 }));
  const segments = historySegments(points);
  assert.deepEqual(segments.map(segment => segment.length), [3, 1]);
  assert.equal(segments[0][0].telemetry_id, 1);
});

test('battery incidents notify both apps immediately with one sound and no emergency reminder', () => {
  const now = Date.now();
  const row = { id: 1, device_id: 'watch', alert_type: 'LOW_BATTERY', created_at: new Date(now).toISOString(), details: { incident_open: true, status: 'PENDING_FAMILY', battery_percent: 0 } };
  const [incident] = groupAlertIncidents([row]);
  assert.equal(alertTitle(incident), 'Low watch battery');
  assert.match(batteryAlertMessage(incident), /at 0%/);
  assert.equal(needsBarangayAttention(incident, now), true);
  const first = planAlertSounds([incident], {}, now);
  assert.equal(first.events[0].tone, 'battery');
  assert.equal(planAlertSounds([incident], first.ledger, now+155000).events.length, 0);
  assert.equal(groupAlertIncidents([{ ...row, details: { ...row.details, status: 'ACKNOWLEDGED_FAMILY' } }]).length, 0);
  assert.equal(needsBarangayAttention({ ...row, details: { ...row.details, status: 'ACKNOWLEDGED_BHW' } }, now), false);
});

test('SOS and geofence remain ahead of battery alerts regardless of arrival time', () => {
  const rows = ['LOW_BATTERY','GEOFENCE','SOS'].map((alert_type, i) => ({ id: i+1, device_id: 'watch', alert_type, created_at: new Date(Date.now()+i*1000).toISOString(), details: { status: 'PENDING_FAMILY' } }));
  assert.deepEqual(groupAlertIncidents(rows).map(row => row.alert_type), ['SOS','GEOFENCE','LOW_BATTERY']);
});
