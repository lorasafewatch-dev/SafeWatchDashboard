import test from 'node:test';
import assert from 'node:assert/strict';
import { familyZoneBounds, familyZoneContains, safeZoneErrorMessage, saveFamilySafeZone, validateFamilySafeZone } from './familySafeZone.js';

const id = '10000000-0000-0000-0000-000000000001';
const zone = { name: 'Home', lat: 14.039, lng: 121.14, radius: 250 };

test('safe-zone validation accepts named circles and rejects blank, invalid and excessive settings', () => {
  assert.deepEqual(validateFamilySafeZone({ ...zone, name: '  Family   home ', radius: '500', lat: '14.039' }), { ...zone, name: 'Family home', radius: 500 });
  for (const patch of [{ name: '' }, { name: 'a'.repeat(81) }, { lat: '' }, { lat: null }, { lat: 91 }, { lng: -181 }, { lat: 0, lng: 0 }, { radius: 49 }, { radius: 5001 }, { radius: 100.5 }, { radius: Infinity }]) {
    assert.throws(() => validateFamilySafeZone({ ...zone, ...patch }));
  }
});

test('a family circle replaces the default boundary for that watch', () => {
  const oldInside = { lat: 14.039, lng: 121.123 };
  const customInside = { lat: zone.lat, lng: zone.lng };
  assert.equal(familyZoneContains(oldInside, null), true);
  assert.equal(familyZoneContains(customInside, null), false);
  assert.equal(familyZoneContains(oldInside, zone), false);
  assert.equal(familyZoneContains(customInside, zone), true);
  assert.equal(familyZoneContains({ ...customInside, lat: customInside.lat + .001 }, zone), true);
  assert.equal(familyZoneContains({ ...customInside, lat: customInside.lat + .003 }, zone), false);
  assert.equal(familyZoneContains(null, zone), false);
  assert.equal(familyZoneContains({ lat: 0, lng: 0 }, zone), false);
});

test('zone checks handle the date line and map bounds enclose a circle', () => {
  assert.equal(familyZoneContains({ lat: 10, lng: -179.999 }, { ...zone, lat: 10, lng: 179.999, radius: 500 }), true);
  const [[south, west], [north, east]] = familyZoneBounds(zone);
  assert.ok(south < zone.lat && north > zone.lat && west < zone.lng && east > zone.lng);
  assert.ok(familyZoneBounds(null).length > 3);
});

test('saving sends the selected watch and previous revision and verifies the stored result', async () => {
  const prior = { ...zone, revision: 'old' };
  const saved = { ...zone, revision: 'new', updated_at: '2026-11-01T00:00:00Z' };
  let received;
  const client = { rpc: async (name, args) => { received = { name, args }; return { data: { device_id: id, zone: saved }, error: null }; } };
  assert.deepEqual(await saveFamilySafeZone(client, id, zone, prior), saved);
  assert.deepEqual(received, { name: 'save_family_safe_zone', args: { p_device_id: id, p_zone: zone, p_expected_zone: prior } });
  assert.equal(await saveFamilySafeZone({ rpc: async () => ({ data: { device_id: id, zone: null }, error: null }) }, id, null, saved), null);
});

test('failed and unverified writes never report success', async () => {
  const conflict = { code: '40001', message: 'conflict' };
  await assert.rejects(saveFamilySafeZone({ rpc: async () => ({ data: null, error: conflict }) }, id, zone, null), error => error === conflict);
  for (const data of [null, { device_id: 'another', zone }, { device_id: id }, { device_id: id, zone }, { device_id: id, zone: { ...zone, radius: 100, revision: 'new' } }]) {
    await assert.rejects(saveFamilySafeZone({ rpc: async () => ({ data, error: null }) }, id, zone, null), /could not be verified/);
  }
  assert.match(safeZoneErrorMessage(conflict), /Another family member/);
  assert.match(safeZoneErrorMessage({ code: '42501' }), /linked/);
});
