import test from 'node:test';
import assert from 'node:assert/strict';
import { monitoringSummary, readingStatus, readingText, readingValue, watchUpdate } from '../src/adminPresentation.js';

const now = Date.parse('2026-10-30T03:00:00Z');
const senior = changes => ({ positionAt: new Date(now - 12000).toISOString(), pulse: 72, spo2: 98, battery: 86, ...changes });

test('watch connectivity uses packet freshness independently of GPS availability', () => {
  const record = senior({ hasGpsLock: false });
  assert.equal(watchUpdate(record, now).fresh, true);
  assert.equal(monitoringSummary([record], now).offline, 0);
  assert.equal(watchUpdate(record, now).label, '12s ago');
});
test('three missed packets expire a watch; absent and invalid dates never appear online', () => {
  for (const positionAt of [null, 'invalid', new Date(now - 45001).toISOString(), new Date(now + 5001).toISOString()]) {
    assert.equal(watchUpdate(senior({ positionAt }), now).fresh, false);
  }
  assert.equal(watchUpdate(senior({ positionAt: new Date(now - 45000).toISOString() }), now).fresh, true);
  assert.equal(watchUpdate(senior({ positionAt: null }), now).label, 'No updates yet');
});
test('zero or missing physiological values render as absent, while a zero battery is valid', () => {
  const record = senior({ pulse: 0, spo2: null, battery: 0 });
  assert.equal(readingText(record, 'pulse', ' bpm'), '—');
  assert.equal(readingText(record, 'spo2', '%'), '—');
  assert.equal(readingValue(record, 'battery'), 0);
  assert.equal(readingText(record, 'battery', '%'), '0%');
  assert.equal(readingValue(senior({ positionAt: null }), 'battery'), null);
  assert.equal(readingValue(senior({ spo2: 101 }), 'spo2'), null);
});
test('stale readings stay visible but are labeled as last readings', () => {
  const record = senior({ positionAt: new Date(now - 480000).toISOString() });
  assert.equal(readingText(record, 'pulse', ' bpm'), '72 bpm');
  assert.deepEqual(readingStatus(record, 'pulse', now), { label: 'Last reading', tone: 'muted' });
  assert.equal(watchUpdate(record, now).label, '8 min ago');
});
test('health averages exclude missing and stale readings, without declaring absent data normal', () => {
  const summary = monitoringSummary([senior({ pulse: 80 }), senior({ pulse: null, spo2: null }), senior({ positionAt: new Date(now - 480000).toISOString(), pulse: 200 })], now);
  assert.equal(summary.pulse, 80);
  assert.equal(summary.spo2, 98);
  assert.equal(summary.online, 2);
  assert.equal(summary.offline, 1);
  assert.equal(summary.health, 'Awaiting data');
  assert.equal(monitoringSummary([], now).health, 'Awaiting data');
});
test('current readings outside the existing display ranges require review', () => {
  assert.equal(readingStatus(senior({ pulse: 108 }), 'pulse', now).tone, 'warning');
  assert.equal(readingStatus(senior({ spo2: 94 }), 'spo2', now).tone, 'warning');
  assert.equal(monitoringSummary([senior({ pulse: 108 })], now).health, 'Review');
});
