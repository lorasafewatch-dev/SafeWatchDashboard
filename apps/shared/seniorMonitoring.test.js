import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingSeniors } from './seniorSearch.js';
import { buildBellNotifications, markNotificationsRead, unreadNotifications } from './notificationCenter.js';
import { MAX_PHOTO_BYTES, validateSeniorPhoto } from './seniorPhotos.js';
import { groupAlertIncidents } from './alertLifecycle.js';

test('partial case-insensitive names retain distinct Watch IDs and the caller-approved scope', () => {
  const approved = [{ id: 'a', patient_name: 'Carmen Santos' }, { id: 'b', name: 'Carmen Santos' }];
  assert.deepEqual(matchingSeniors(approved, '  mEn sA  ').map(row => row.id), ['a', 'b']);
  assert.deepEqual(matchingSeniors(approved, 'Unapproved Senior'), []);
  assert.deepEqual(matchingSeniors(approved, 'nobody'), []);
});

test('request notifications use persistent request IDs, are separate from safety, and deduplicate retries', () => {
  const request = { id: 42, status: 'pending', created_at: '2026-11-19T00:00:00Z' };
  const admin = buildBellNotifications([], [], 'staff', [request, { ...request }], 'barangay');
  assert.equal(admin.length, 1); assert.equal(admin[0].category, 'access');
  assert.equal(admin[0].title, 'New family access request'); assert.equal(admin[0].active, false);
  const read = markNotificationsRead([], [admin[0].key]);
  assert.equal(unreadNotifications(buildBellNotifications([], [], 'staff', [request], 'barangay'), read).length, 0);
  assert.equal(buildBellNotifications([], [], 'family', [request]).length, 0);
  const reviewed = { ...request, status: 'approved', reviewed_at: '2026-11-19T00:30:00Z' };
  const family = buildBellNotifications([], [], 'family', [reviewed]);
  assert.equal(family[0].title, 'Family access request approved');
  assert.equal(family[0].at, reviewed.reviewed_at);
  assert.equal(buildBellNotifications([], [], 'staff', [reviewed], 'barangay').length, 0);
  const rejected = buildBellNotifications([], [], 'family', [{ ...reviewed, status: 'rejected' }]);
  assert.equal(rejected[0].title, 'Family access request rejected');
  assert.notEqual(rejected[0].key, family[0].key);
});

test('uploads reject spoofed content, active formats, oversized and empty photos', async () => {
  await assert.rejects(validateSeniorPhoto(new File(['bad'], 'photo.png', { type: 'image/png' })), /not a valid photo/);
  await assert.rejects(validateSeniorPhoto(new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' })), /JPEG, PNG, or WebP/);
  await assert.rejects(validateSeniorPhoto(new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], 'photo.jpg', { type: 'image/jpeg' })), /up to 2 MB/);
  await assert.rejects(validateSeniorPhoto(new File([], 'empty.jpg', { type: 'image/jpeg' })), /up to 2 MB/);
  await validateSeniorPhoto(new File([new Uint8Array([255,216,255,224])], 'photo.jpg', { type: 'image/jpeg' }));
});

test('grouped legacy SOS packets keep the opening location', () => {
  const opened = { point: { lat: 14.039, lng: 121.123 } };
  const records = [1, 2].map(id => ({ id, device_id: 'watch', alert_type: 'SOS', created_at: `2026-11-19T00:00:0${id}Z`, details: { status: 'PENDING_FAMILY', sos_location: id === 1 ? opened : { point: { lat: 15, lng: 122 } } } }));
  assert.deepEqual(groupAlertIncidents(records)[0].details.sos_location, opened);
});
