import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.tools/alert-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { postgis } from '../../.tools/alert-tests/node_modules/@electric-sql/pglite-postgis/dist/index.js';
import { familyZoneContains } from '../../apps/shared/familySafeZone.js';

const pg = new PGlite({ extensions: { postgis } });
const [family, other, outsider, staff, watch, second] = Array.from({ length: 6 }, (_, i) => '80000000-0000-0000-0000-' + String(i + 1).padStart(12, '0'));
const q = async (sql, args = []) => (await pg.query(sql, args)).rows;
const asUser = async (id, action, role = 'authenticated') => {
  await q("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id || '', JSON.stringify({ sub: id, aal: 'aal2' })]);
  await pg.exec('SET ROLE ' + role);
  try { return await action(); } finally { await pg.exec('RESET ROLE'); }
};
const save = async (zone, expected = null, device = watch, user = family) => asUser(user, async () => (await q('SELECT save_family_safe_zone($1,$2,$3) AS result', [device, zone, expected]))[0].result.zone);
const active = async type => q("SELECT * FROM alerts WHERE device_id=$1 AND alert_type=$2 AND details->>'incident_open'='true'", [watch, type]);
const packet = async (location, sos = false, receivedAge = '0 seconds', device = watch) => q("INSERT INTO telemetry(device_id,location,is_sos,created_at,rx_uptime_ms,received_at) VALUES($1,ST_GeogFromText($2),$3,now(),1000,now()-$4::interval)", [device, location, sos, receivedAge]);
const zone = { name: 'Family home', lat: 14.039, lng: 121.14, radius: 250 };

try {
  await pg.exec(`
    CREATE EXTENSION postgis;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id UUID PRIMARY KEY,email TEXT UNIQUE,email_confirmed_at TIMESTAMPTZ,raw_user_meta_data JSONB DEFAULT '{}',raw_app_meta_data JSONB DEFAULT '{}');
    CREATE TABLE auth.mfa_factors(id TEXT PRIMARY KEY,user_id UUID,status TEXT);
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE SQL STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
    CREATE TABLE devices(id UUID PRIMARY KEY,patient_name TEXT,device_name TEXT);
    CREATE TABLE telemetry(id BIGSERIAL PRIMARY KEY,device_id UUID REFERENCES devices,location GEOGRAPHY(POINT,4326),is_sos BOOLEAN,created_at TIMESTAMPTZ DEFAULT now(),rx_uptime_ms BIGINT,received_at TIMESTAMPTZ);
    CREATE TABLE alerts(id BIGSERIAL PRIMARY KEY,device_id UUID REFERENCES devices,alert_type TEXT,details JSONB,created_at TIMESTAMPTZ DEFAULT now());
    ALTER TABLE devices ENABLE ROW LEVEL SECURITY; ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY; ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY legacy_devices ON devices FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
    CREATE POLICY legacy_telemetry ON telemetry FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
    CREATE POLICY legacy_alerts ON alerts FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon,authenticated;
  `);
  for (const [id, app] of [[family,'family'],[other,'family'],[outsider,'family'],[staff,'dashboard']]) {
    await q('INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) VALUES($1,$2,now(),$3,$4)', [id, id+'@example.test', { requested_app: app }, id===staff ? { role: 'barangay' } : {}]);
  }
  for (const name of ['20261009_alert_incidents.sql','20261013_family_seniors.sql','20261013_notification_confirmation.sql','20261013_account_access.sql','20261027_family_access_approval.sql','20261027_identity_hardening.sql','20261030_senior_watch_removal.sql','20261101_family_safe_zones.sql']) {
    await pg.exec(await readFile(new URL('../migrations/'+name, import.meta.url), 'utf8'));
  }
  await pg.exec('CREATE TRIGGER telemetry_geofence_trigger AFTER INSERT ON telemetry FOR EACH ROW EXECUTE FUNCTION check_geofence()');
  await q('INSERT INTO auth.mfa_factors VALUES($1,$2,$3)', ['staff-factor',staff,'verified']);
  await q('INSERT INTO devices(id,patient_name,device_name) VALUES($1,$2,$3),($4,$5,$6)', [watch,'Senior One','Watch',second,'Senior Two','Watch']);
  await q('INSERT INTO family_seniors(user_id,device_id) VALUES($1,$2),($3,$2),($1,$4)', [family,watch,other,second]);
  await pg.exec(await readFile(new URL('../migrations/20261101_family_safe_zones.sql', import.meta.url), 'utf8'));
  assert.equal((await q('SELECT * FROM family_seniors')).length,3);
  assert.equal((await q('SELECT family_safe_zone FROM devices WHERE id=$1',[watch]))[0].family_safe_zone,null);
  console.log('PASS repeatable migration retains watches, links and default boundaries');

  await packet('POINT(121.14 14.039)',true);
  const oldIncident = (await active('GEOFENCE'))[0];
  const oldSos = (await active('SOS'))[0];
  assert.ok(oldIncident && oldSos);
  const saved = await save(zone);
  assert.equal(saved.name,zone.name); assert.ok(saved.revision);
  assert.equal((await active('GEOFENCE')).length,0);
  assert.equal((await active('SOS'))[0].id,oldSos.id);
  assert.equal((await q('SELECT * FROM alerts WHERE id=$1',[oldIncident.id]))[0].details.resolved_reason,'safe_zone_changed');
  await asUser(other, async () => assert.deepEqual((await q('SELECT family_safe_zone FROM devices WHERE id=$1',[watch]))[0].family_safe_zone,saved));
  assert.equal((await q('SELECT family_safe_zone FROM devices WHERE id=$1',[second]))[0].family_safe_zone,null);
  console.log('PASS linked families share a zone; other seniors and SOS are unchanged; old-zone incidents retain history');

  await assert.rejects(save(zone,null,watch,outsider), error => error.code==='42501');
  await assert.rejects(save(zone,null,watch,staff), error => error.code==='42501');
  await asUser(null, () => assert.rejects(q('SELECT save_family_safe_zone($1,$2,null)',[watch,zone]), /permission denied/), 'anon');
  await asUser(family, async () => assert.equal((await q('UPDATE devices SET family_safe_zone=null WHERE id=$1 RETURNING id',[watch])).length,0));
  await asUser(outsider, async () => assert.equal((await q('SELECT * FROM devices')).length,0));
  console.log('PASS anonymous, unlinked and staff accounts cannot use the family write endpoint; direct family writes and unlinked reads are blocked');

  for (const patch of [{name:''},{name:'x'.repeat(81)},{lat:''},{lat:91},{lng:-181},{lat:0,lng:0},{radius:49},{radius:5001},{radius:75.5}]) {
    await assert.rejects(save({...zone,...patch},saved), error => error.code==='22023');
  }
  await assert.rejects(save({...zone,radius:400},null), error => error.code==='40001');
  const updated = await save({...zone,name:'Updated home',radius:400},saved,watch,other);
  assert.notEqual(updated.revision,saved.revision);
  await assert.rejects(save(zone,saved), error => error.code==='40001');
  console.log('PASS invalid geometry and radii are rejected; concurrent edits require the current revision');

  for (const [point, custom] of [[{lat:14.039,lng:121.14},updated],[{lat:14.039,lng:121.123},updated],[{lat:14.039,lng:121.123},null],[{lat:10,lng:-179.999},{...zone,lat:10,lng:179.999,radius:500}]]) {
    const [{inside}] = await q('SELECT _safewatch_family_zone_contains(ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,$3) AS inside',[point.lng,point.lat,custom]);
    assert.equal(inside,familyZoneContains(point,custom));
  }
  await packet('POINT(121.14 14.039)');
  assert.equal((await active('GEOFENCE')).length,0,'Custom circle accepts a point outside the barangay');
  await packet('POINT(121.123 14.039)');
  let incident = (await active('GEOFENCE'))[0];
  assert.equal(incident.details.zone_name,'Updated home');
  assert.equal(incident.details.zone_revision,updated.revision);
  await packet('POINT(121.123 14.039)');
  assert.equal((await active('GEOFENCE'))[0].id,incident.id);
  await packet('POINT(0 0)');
  await packet('POINT(121.14 14.039)',false,'2 minutes');
  assert.equal((await active('GEOFENCE'))[0].id,incident.id);
  await packet('POINT(121.14 14.039)');
  assert.equal((await active('GEOFENCE')).length,0);
  await packet('POINT(121.123 14.039)');
  assert.notEqual((await active('GEOFENCE'))[0].id,incident.id);
  console.log('PASS backend and UI agree; custom zones replace the default; breach, repeated packets, no-fix/stale packets, resolution and rearming work');

  assert.equal(await save(null,updated),null);
  await packet('POINT(121.123 14.039)');
  assert.equal((await active('GEOFENCE')).length,0);
  await packet('POINT(121.14 14.039)');
  assert.equal((await active('GEOFENCE'))[0].details.zone_name,'San Isidro East');
  await asUser(staff, () => q('SELECT revoke_family_senior_access($1,$2)',[family,watch]));
  await assert.rejects(save(zone), error => error.code==='42501');
  assert.ok((await q("SELECT * FROM safewatch_access_audit WHERE action='family_safe_zone_changed'")).length >= 3);
  console.log('PASS restoring the default resumes default monitoring; revoked access cannot save; changes are audited');
} finally { await pg.close(); }
