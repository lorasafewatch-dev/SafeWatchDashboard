import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.tools/alert-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { postgis } from '../../.tools/alert-tests/node_modules/@electric-sql/pglite-postgis/dist/index.js';

const pg = new PGlite({ extensions: { postgis } });
const [family, outsider, staff, watch, second] = Array.from({ length: 5 }, (_, i) => '90000000-0000-0000-0000-' + String(i+1).padStart(12,'0'));
const q = async (sql, args = []) => (await pg.query(sql, args)).rows;
const asUser = async (id, action, role = 'authenticated', aal = 'aal2') => {
  await q("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id || '', JSON.stringify({ sub: id, aal })]);
  await pg.exec('SET ROLE '+role);
  try { return await action(); } finally { await pg.exec('RESET ROLE'); }
};
const migration = await readFile(new URL('../migrations/20261103_battery_location_history.sql',import.meta.url),'utf8');
const active = async () => q("SELECT * FROM alerts WHERE device_id=$1 AND alert_type='LOW_BATTERY' AND details->>'incident_open'='true'",[watch]);
const packet = async (battery, age = '0 seconds', location = 'POINT(0 0)', device = watch, instrumented = true) => q(`INSERT INTO telemetry(device_id,battery_percent,location,is_sos,created_at,received_at,rx_uptime_ms)
  VALUES($1,$2,ST_GeogFromText($3),false,now(),now()-$4::interval,$5) RETURNING id`, [device,battery,location,age,instrumented?1000:null]);
const history = (device = watch, before = null, limit = 201) => q('SELECT * FROM get_watch_location_history($1,$2,$3,$4,$5,$6)',
  [device,'2026-11-02T16:00:00Z','2026-11-03T16:00:00Z',before?.observed_at ?? null,before?.telemetry_id ?? null,limit]);

try {
  await pg.exec(`CREATE EXTENSION postgis;
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
    CREATE TABLE telemetry(id BIGSERIAL PRIMARY KEY,device_id UUID REFERENCES devices,location GEOGRAPHY(POINT,4326),battery_percent INTEGER,is_sos BOOLEAN,created_at TIMESTAMPTZ DEFAULT now(),rx_uptime_ms BIGINT,received_at TIMESTAMPTZ);
    CREATE TABLE alerts(id BIGSERIAL PRIMARY KEY,device_id UUID REFERENCES devices,alert_type TEXT,details JSONB,created_at TIMESTAMPTZ DEFAULT now());
    ALTER TABLE devices ENABLE ROW LEVEL SECURITY; ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY; ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY legacy_devices ON devices FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
    CREATE POLICY legacy_telemetry ON telemetry FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
    CREATE POLICY legacy_alerts ON alerts FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon,authenticated;`);
  for (const [id, app] of [[family,'family'],[outsider,'family'],[staff,'dashboard']]) await q('INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) VALUES($1,$2,now(),$3,$4)',[id,id+'@example.test',{requested_app:app},id===staff?{role:'barangay'}:{}]);
  for (const name of ['20261009_alert_incidents.sql','20261013_family_seniors.sql','20261013_notification_confirmation.sql','20261013_account_access.sql','20261027_family_access_approval.sql','20261027_identity_hardening.sql','20261030_senior_watch_removal.sql','20261101_family_safe_zones.sql']) await pg.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
  await pg.exec('CREATE TRIGGER telemetry_geofence_trigger AFTER INSERT ON telemetry FOR EACH ROW EXECUTE FUNCTION check_geofence()');
  await q('INSERT INTO auth.mfa_factors VALUES($1,$2,$3)',['staff-factor',staff,'verified']);
  await q('INSERT INTO devices(id,patient_name,device_name) VALUES($1,$2,$3),($4,$5,$6)',[watch,'Senior One','Watch',second,'Senior Two','Watch']);
  await q('INSERT INTO family_seniors(user_id,device_id) VALUES($1,$2)',[family,watch]);
  await packet(10,'1 day');
  await pg.exec(migration); await pg.exec(migration);
  assert.equal((await active()).length,0);
  console.log('PASS repeatable migration preserves existing telemetry and waits for a fresh battery reading');

  await packet(20);
  const first = (await active())[0]; assert.equal(first.details.battery_percent,20);
  await packet(0); await packet(21); await packet(24);
  assert.equal((await active()).length,1); assert.equal((await active())[0].id,first.id);
  assert.equal((await active())[0].details.update_count,4);
  assert.equal((await active())[0].details.battery_percent,24);
  console.log('PASS threshold includes 20% and 0%; repeated readings and 21–24% maintain one incident without GPS');

  await asUser(outsider, () => assert.rejects(q('SELECT acknowledge_alert_incident($1,$2)',[first.id,'family']), error=>error.code==='42501'));
  assert.equal((await asUser(family,()=>q('SELECT acknowledge_alert_incident($1,$2) AS saved',[first.id,'family'])))[0].saved,true);
  await packet(18); assert.equal((await active())[0].details.status,'ACKNOWLEDGED_FAMILY');
  await packet(25); assert.equal((await active()).length,0);
  await packet(19); const next=(await active())[0]; assert.notEqual(next.id,first.id);
  assert.equal((await asUser(staff,()=>q('SELECT acknowledge_alert_incident($1,$2) AS saved',[next.id,'barangay'])))[0].saved,true);
  await packet(15); assert.equal((await active())[0].details.status,'ACKNOWLEDGED_BHW');
  console.log('PASS family/staff confirmation persists; recovery to 25% rearms the next drop; unlinked confirmation is denied');

  await packet(80,'2 minutes'); await packet(null); await packet(101); await packet(-1);
  await packet(80,'-10 seconds'); await packet(80,'10 seconds');
  await q('INSERT INTO telemetry(device_id,battery_percent,rx_uptime_ms) VALUES($1,80,1000)',[watch]);
  assert.equal((await active())[0].details.battery_percent,15);
  await packet(80); assert.equal((await active()).length,0);
  await packet(10,'10 seconds'); assert.equal((await active()).length,0);
  console.log('PASS stale, invalid, unknown-time, future and reordered packets cannot replace a newer battery state');

  await packet(80,'0 seconds','POINT(121.14 14.039)');
  assert.equal((await q("SELECT * FROM alerts WHERE device_id=$1 AND alert_type='GEOFENCE' AND details->>'incident_open'='true'",[watch])).length,1);
  await q("INSERT INTO telemetry(device_id,location,battery_percent,is_sos,received_at,rx_uptime_ms) VALUES($1,ST_GeogFromText('POINT(0 0)'),10,true,now(),1000)",[watch]);
  assert.equal((await q("SELECT * FROM alerts WHERE device_id=$1 AND alert_type='SOS' AND details->>'incident_open'='true'",[watch])).length,1);
  assert.equal((await active()).length,1);
  console.log('PASS battery trigger coexists with geofence and SOS incidents');

  // Fixed historical timestamps test Philippine day boundaries independently of host date.
  await q(`INSERT INTO telemetry(device_id,location,battery_percent,is_sos,received_at,rx_uptime_ms,created_at)
    SELECT $1,ST_GeogFromText('POINT(121.123 14.039)'),80,false,'2026-11-03T01:00:00Z',1000,now() FROM generate_series(1,205)`,[watch]);
  await q(`INSERT INTO telemetry(device_id,location,is_sos,received_at,rx_uptime_ms,created_at) VALUES
    ($1,ST_GeogFromText('POINT(121.124 14.04)'),false,'2026-11-02T16:00:00Z',1000,now()),
    ($1,ST_GeogFromText('POINT(121.125 14.04)'),false,'2026-11-03T16:00:00Z',1000,now()),
    ($1,ST_GeogFromText('POINT(0 0)'),false,'2026-11-03T01:00:00Z',1000,now()),
    ($1,ST_GeogFromText('POINT(121.123 14.039)'),false,null,1000,'2026-11-03T01:00:00Z'),
    ($1,ST_GeogFromText('POINT(121.123 14.039)'),false,null,null,'2026-11-03T01:00:00Z'),
    ($2,ST_GeogFromText('POINT(121.123 14.039)'),false,'2026-11-03T01:00:00Z',1000,now())`,[watch,second]);
  const all = await asUser(family,()=>history(watch,null,500));
  const fixed = all.filter(row=>row.observed_at.toISOString()<='2026-11-03T01:00:00.000Z');
  assert.equal(fixed.length,207); // 205 tied RF times, one legacy, inclusive midnight.
  assert.equal(fixed.at(-1).observed_at.toISOString(),'2026-11-02T16:00:00.000Z');
  const page1 = await asUser(family,()=>history(watch,null,200));
  const page2 = await asUser(family,()=>history(watch,page1.at(-1),500));
  assert.equal(new Set([...page1,...page2].map(row=>row.telemetry_id)).size,all.length);
  assert.deepEqual([...page1,...page2].map(row=>row.telemetry_id),all.map(row=>row.telemetry_id));
  assert.equal(all.some(row=>row.lat===0&&row.lng===0),false);
  assert.ok((await asUser(staff,()=>history(second))).length);
  console.log('PASS historical/legacy GPS reads, no-fix exclusions, Philippine midnight and tied-time pagination without omissions or duplicates');

  await asUser(outsider,()=>assert.rejects(history(),error=>error.code==='42501'));
  await asUser(family,()=>assert.rejects(history(second),error=>error.code==='42501'));
  await asUser(staff,()=>assert.rejects(history(),error=>error.code==='42501'),'authenticated','aal1');
  await asUser(null,()=>assert.rejects(history(),/permission denied/),'anon');
  await asUser(family,()=>assert.rejects(q('SELECT _safewatch_acknowledge_incident($1,$2)',[first.id,'family']),/permission denied/));
  await asUser(family,()=>assert.rejects(history(watch,null,501),error=>error.code==='22023'));
  await asUser(family,()=>assert.rejects(q('SELECT * FROM get_watch_location_history($1,now(),now()-interval \'1 day\')',[watch]),error=>error.code==='22023'));
  await asUser(family,()=>assert.rejects(q('SELECT * FROM get_watch_location_history($1,now()-interval \'8 days\',now())',[watch]),error=>error.code==='22023'));
  await q('DELETE FROM family_seniors WHERE user_id=$1 AND device_id=$2',[family,watch]);
  await asUser(family,()=>assert.rejects(history(),error=>error.code==='42501'));
  console.log('PASS anonymous, unlinked, revoked and staff without MFA cannot read history; private confirmation and unbounded queries are denied');
} finally { await pg.close(); }
