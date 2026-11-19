import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.tools/alert-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { postgis } from '../../.tools/alert-tests/node_modules/@electric-sql/pglite-postgis/dist/index.js';

const pg = new PGlite({ extensions: { postgis } });
const [family, outsider, staff, watch, second] = Array.from({ length: 5 }, (_, i) => '91000000-0000-0000-0000-' + String(i + 1).padStart(12, '0'));
const q = async (sql, args = []) => (await pg.query(sql, args)).rows;
async function asUser(id, action, role = 'authenticated') {
  await q("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id || '', JSON.stringify({ sub: id, aal: 'aal2' })]);
  await pg.exec('SET ROLE ' + role);
  try { return await action(); } finally { await pg.exec('RESET ROLE'); }
}
const migration = await readFile(new URL('../migrations/20261118164949_senior_monitoring_features.sql', import.meta.url), 'utf8');
try {
  await pg.exec(`CREATE EXTENSION postgis;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id UUID PRIMARY KEY,email TEXT UNIQUE,email_confirmed_at TIMESTAMPTZ,raw_user_meta_data JSONB DEFAULT '{}',raw_app_meta_data JSONB DEFAULT '{}');
    CREATE TABLE auth.mfa_factors(id TEXT PRIMARY KEY,user_id UUID,status TEXT);
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE SQL STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    GRANT USAGE ON SCHEMA auth,storage TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
    CREATE TABLE devices(id UUID PRIMARY KEY,patient_name TEXT,device_name TEXT);
    CREATE TABLE telemetry(id BIGSERIAL PRIMARY KEY,device_id UUID REFERENCES devices,location GEOGRAPHY(POINT,4326),heart_rate INTEGER,spo2 INTEGER,battery_percent INTEGER,is_sos BOOLEAN,created_at TIMESTAMPTZ DEFAULT now(),rx_uptime_ms BIGINT,received_at TIMESTAMPTZ);
    CREATE TABLE alerts(id BIGSERIAL PRIMARY KEY,device_id UUID REFERENCES devices,alert_type TEXT,details JSONB,created_at TIMESTAMPTZ DEFAULT now());
    ALTER TABLE devices ENABLE ROW LEVEL SECURITY; ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY; ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY legacy_devices ON devices FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
    CREATE POLICY legacy_telemetry ON telemetry FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
    CREATE POLICY legacy_alerts ON alerts FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon,authenticated;
    CREATE TABLE storage.buckets(id TEXT PRIMARY KEY,name TEXT,public BOOLEAN,file_size_limit BIGINT,allowed_mime_types TEXT[]);
    CREATE TABLE storage.objects(id UUID DEFAULT gen_random_uuid(),bucket_id TEXT,name TEXT,metadata JSONB,owner_id TEXT);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON storage.objects TO anon,authenticated;
    CREATE POLICY unrelated_legacy_storage ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);`);
  for (const [id, app] of [[family, 'family'], [outsider, 'family'], [staff, 'dashboard']]) await q('INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) VALUES($1,$2,now(),$3,$4)', [id, id + '@example.test', { requested_app: app }, id === staff ? { role: 'barangay' } : {}]);
  for (const name of ['20261009_alert_incidents.sql', '20261013_family_seniors.sql', '20261013_notification_confirmation.sql', '20261013_account_access.sql', '20261027_family_access_approval.sql', '20261027_identity_hardening.sql', '20261030_senior_watch_removal.sql', '20261101_family_safe_zones.sql', '20261103_battery_location_history.sql', '20261103_sos_response_handoff.sql']) await pg.exec(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  await q('INSERT INTO auth.mfa_factors VALUES($1,$2,$3)', ['staff-factor', staff, 'verified']);
  await q("INSERT INTO devices(id,patient_name,device_name) VALUES($1,'Same Name','Watch'),($2,'Same Name','Watch')", [watch, second]);
  await q('INSERT INTO family_seniors(user_id,device_id) VALUES($1,$2)', [family, watch]);
  // Historical SOS has only a stale fix. Applying the migration must not use current GPS.
  await q("INSERT INTO telemetry(device_id,location,received_at) VALUES($1,ST_GeogFromText('POINT(121.123 14.039)'),now()-interval '1 day')", [watch]);
  const old = (await q("INSERT INTO alerts(device_id,alert_type,created_at,details) VALUES($1,'SOS',now()-interval '1 hour','{\"status\":\"RESOLVED\"}') RETURNING id", [watch]))[0];
  await pg.exec(migration); await pg.exec(migration);
  assert.equal((await q('SELECT details FROM alerts WHERE id=$1', [old.id]))[0].details.sos_location.point, null);
  assert.equal((await q("SELECT public FROM storage.buckets WHERE id='senior-photos'"))[0].public, false);
  console.log('PASS repeatable migration preserves history and does not invent historical SOS locations');

  const familyMigration = await readFile(new URL('../migrations/20261119092322_family_senior_photo_editing.sql', import.meta.url), 'utf8');
  await pg.exec(familyMigration); await pg.exec(familyMigration);
  const photo = n => `${watch}/92000000-0000-0000-0000-${String(n).padStart(12,'0')}.webp`;
  const upload = (id, name, metadata = { mimetype: 'image/webp', size: 100 }) => asUser(id, () => q("INSERT INTO storage.objects(bucket_id,name,metadata,owner_id) VALUES('senior-photos',$1,$2,$3) RETURNING name", [name, metadata, id]));
  const attach = (id, name, device = watch) => asUser(id, () => q('SELECT set_senior_photo($1,$2) result', [device, name]));
  const visible = id => asUser(id, () => q("SELECT name FROM storage.objects WHERE bucket_id='senior-photos' ORDER BY name"));
  const remove = (id, name) => asUser(id, () => q("DELETE FROM storage.objects WHERE bucket_id='senior-photos' AND name=$1 RETURNING name", [name]));

  await upload(staff, photo(1)); await attach(staff, photo(1));
  assert.deepEqual((await visible(family)).map(row => row.name), [photo(1)]);
  assert.equal((await visible(outsider)).length,0);
  await q("INSERT INTO safewatch_family_requests(user_id,device_id,kind,status) VALUES($1,$2,'link','pending')",[outsider,watch]);
  await assert.rejects(upload(outsider,photo(2)), error => error.code==='42501');
  await assert.rejects(attach(outsider,null), error => error.code==='42501');
  await asUser(null, async () => { assert.equal((await q('SELECT * FROM storage.objects')).length,0); await assert.rejects(q('SELECT set_senior_photo($1,null)',[watch]),/permission denied/); },'anon');
  console.log('PASS staff writes and approved-family reads remain available; pending, unlinked and anonymous accounts are blocked');

  await upload(family,photo(3));
  assert.equal((await attach(family,photo(3)))[0].result.photo_path,photo(3));
  assert.equal((await remove(family,photo(3))).length,0);
  await asUser(family, async () => assert.equal((await q("UPDATE storage.objects SET metadata='{}' WHERE name=$1 RETURNING name",[photo(3)])).length,0));
  await upload(family,photo(4)); await attach(family,photo(4));
  assert.equal((await remove(family,photo(3))).length,1);
  assert.equal((await attach(family,null))[0].result.photo_path,null);
  assert.equal((await remove(family,photo(4))).length,1);
  assert.equal((await remove(family,photo(1))).length,0);
  console.log('PASS approved family upload, replace, detach and own-object cleanup; current photos, immutable objects and other uploaders are protected');

  await assert.rejects(upload(family,photo(5).replace(watch,second)),error=>error.code==='42501');
  await assert.rejects(attach(family,null,second),error=>error.code==='42501');
  await assert.rejects(upload(family,'------------------------------------/------------------------------------.webp'),error=>error.code==='42501');
  for(const [n,metadata] of [[6,{mimetype:'image/svg+xml',size:100}],[7,{mimetype:'image/webp',size:2097153}]]) {
    await upload(family,photo(n),metadata); await assert.rejects(attach(family,photo(n)),error=>error.code==='22023');
  }
  await upload(family,photo(8)); await attach(family,photo(8));
  await q('DELETE FROM family_seniors WHERE user_id=$1 AND device_id=$2',[family,watch]);
  assert.equal((await visible(family)).length,0);
  await assert.rejects(upload(family,photo(9)),error=>error.code==='42501');
  await assert.rejects(attach(family,null),error=>error.code==='42501');
  assert.equal((await remove(family,photo(8))).length,0);
  assert((await visible(staff)).some(row=>row.name===photo(8)));
  console.log('PASS exact Watch ID isolation, invalid paths, MIME/size validation, immediate revocation and staff access');
} finally { await pg.close(); }

