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
    CREATE TABLE storage.objects(id UUID DEFAULT gen_random_uuid(),bucket_id TEXT,name TEXT,metadata JSONB);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON storage.objects TO anon,authenticated;
    CREATE POLICY unrelated_legacy_storage ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);`);
  for (const [id, app] of [[family, 'family'], [outsider, 'family'], [staff, 'dashboard']]) await q('INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) VALUES($1,$2,now(),$3,$4)', [id, id + '@example.test', { requested_app: app }, id === staff ? { role: 'barangay' } : {}]);
  for (const name of ['20261009_alert_incidents.sql', '20261013_family_seniors.sql', '20261013_notification_confirmation.sql', '20261013_account_access.sql', '20261027_family_access_approval.sql', '20261027_identity_hardening.sql', '20261029_privacy_terms.sql', '20261030_senior_watch_removal.sql', '20261101_family_safe_zones.sql', '20261103_battery_location_history.sql', '20261103_sos_response_handoff.sql']) await pg.exec(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
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

  await q("INSERT INTO safewatch_privacy_acceptances(user_id,app,version,stage,terms_accepted,account_consent) VALUES($1,'family','2026-10-29','first_login',true,true),($2,'family','2026-10-29','first_login',true,true),($3,'dashboard','2026-10-29','first_login',true,true) ON CONFLICT DO NOTHING",[family,outsider,staff]);
  await pg.exec(`CREATE TABLE safewatch_activity_events(id BIGSERIAL PRIMARY KEY,device_id UUID,category TEXT,event_kind TEXT,alert_type TEXT,status TEXT,details JSONB,source_key TEXT UNIQUE,occurred_at TIMESTAMPTZ DEFAULT now());
    ALTER TABLE safewatch_activity_events ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON safewatch_activity_events TO authenticated;
    CREATE POLICY fixture_activity ON safewatch_activity_events FOR SELECT TO authenticated USING(safewatch_has_app_access('dashboard') OR EXISTS(SELECT 1 FROM family_seniors f WHERE f.user_id=auth.uid() AND f.device_id=safewatch_activity_events.device_id));`);
  const sql = (await readFile(new URL('../migrations/20261119145610_family_first_watch_sos.sql',import.meta.url),'utf8')).replace(/-- BEGIN HOSTED CRON[\s\S]*?-- END HOSTED CRON/,'');
  await pg.exec(sql); await pg.exec(sql);
  await pg.exec('CREATE TRIGGER test_alert_activity AFTER INSERT OR UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION safewatch_record_alert_activity()');
  await pg.exec('CREATE TRIGGER telemetry_geofence_trigger AFTER INSERT ON telemetry FOR EACH ROW EXECUTE FUNCTION check_geofence()');
  const packet = (device=watch, secondsAgo=0, sos=true) => q("INSERT INTO telemetry(device_id,location,is_sos,received_at,created_at,rx_uptime_ms) VALUES($1,ST_GeogFromText('POINT(121.123 14.039)'),$2,clock_timestamp(),clock_timestamp()-($3||' seconds')::interval,1000)",[device,sos,String(secondsAgo)]);
  const current = async (device=watch) => (await q("SELECT * FROM alerts WHERE device_id=$1 AND alert_type='SOS' AND details->>'incident_open'='true' ORDER BY id DESC LIMIT 1",[device]))[0];
  const respond = (row,decision,user=family,role='family') => asUser(user,async()=> (await q('SELECT respond_to_sos($1,$2,$3) result',[row.id,decision,role]))[0].result.alert);
  const readAlert = (user,id) => asUser(user,()=>q('SELECT * FROM alerts WHERE id=$1',[id]));
  const feed = user => asUser(user,()=>q('SELECT * FROM list_sos_response_updates()'));
  const worker = async () => (await q('SELECT safewatch_private.transfer_unanswered_watch_sos() count'))[0].count;
  await packet(); const opened=await current();
  assert.equal(opened.details.status,'PENDING_FAMILY'); assert.equal(opened.details.sos_assigned_to,'family'); assert.equal(opened.details.sos_family_first,true);
  assert.equal(Date.parse(opened.details.sos_family_deadline_at)-Date.parse(opened.details.first_seen_at),180000);
  assert.equal((await readAlert(family,opened.id)).length,1); assert.equal((await readAlert(staff,opened.id)).length,0); assert.equal((await readAlert(outsider,opened.id)).length,0);
  assert.equal(await worker(),0);
  await asUser(staff,async()=>assert.equal((await q('SELECT * FROM safewatch_activity_events WHERE details->>\'alert_id\'=$1',[String(opened.id)])).length,0));
  await assert.rejects(respond(opened,'confirmed',staff,'barangay'),error=>error.code==='42501');
  await asUser(staff,()=>assert.rejects(q("SELECT acknowledge_alert_incident($1,'barangay')",[opened.id]),error=>error.code==='42501'));
  console.log('PASS new watch SOS reaches only linked family; staff queries, activity, and old/current acknowledgment RPCs cannot bypass the handoff');

  await packet(); const repeated=await current();
  assert.equal(repeated.id,opened.id); assert.equal(repeated.details.sos_family_deadline_at,opened.details.sos_family_deadline_at);
  const transferred=await respond(repeated,'declined');
  assert.equal(transferred.id,opened.id); assert.equal(transferred.details.sos_transfer_reason,'family_unavailable'); assert.equal(transferred.details.sos_transferred_by,family);
  assert.deepEqual(transferred.details.sos_location,opened.details.sos_location);
  assert.equal((await readAlert(staff,opened.id)).length,1); assert((await feed(staff)).some(row=>row.id===opened.id));
  const retry=await respond(transferred,'declined'); assert.equal(retry.details.sos_response_version,transferred.details.sos_response_version);
  await packet(); assert.equal((await current()).details.status,'ESCALATED_BHW');
  const acknowledged=await respond(transferred,'confirmed',staff,'barangay'); assert.equal(acknowledged.details.status,'ACKNOWLEDGED_BHW');
  await assert.rejects(respond(acknowledged,'declined'),error=>error.code==='40001');
  await packet(watch,0,false);
  console.log('PASS manual transfer reuses the incident and GPS snapshot, is retry-safe, survives packets and permits staff acknowledgment');

  await q('INSERT INTO family_seniors(user_id,device_id) VALUES($1,$2)',[family,second]);
  await packet(second,181); const due=await current(second);
  assert.equal((await readAlert(staff,due.id)).length,0);
  assert.equal(await worker(),1); const timedOut=await current(second);
  assert.equal(timedOut.id,due.id); assert.equal(timedOut.details.sos_transfer_reason,'automatic_timeout'); assert.equal(timedOut.details.sos_assigned_to,'barangay');
  assert.equal((await readAlert(staff,due.id)).length,1); assert((await feed(family)).some(row=>row.id===due.id)); assert.equal(await worker(),0);
  assert.deepEqual(timedOut.details.sos_location,due.details.sos_location);
  await respond(timedOut,'confirmed',staff,'barangay'); await packet(second,0,false);
  console.log('PASS the unattended worker transfers an overdue SOS without app activity; repeated worker runs do not duplicate the handoff');

  await packet(watch,181); const familyHandled=await current(); await respond(familyHandled,'confirmed');
  assert.equal(await worker(),0); assert.equal((await readAlert(staff,familyHandled.id)).length,0);
  assert(!(await feed(staff)).some(row=>row.id===familyHandled.id));
  assert((await feed(family)).some(row=>row.id===familyHandled.id));
  await packet(watch,0,false);
  await asUser(family,()=>assert.rejects(q('SELECT safewatch_private.transfer_unanswered_watch_sos()'),/permission denied/));
  await asUser(null,()=>assert.rejects(q('SELECT safewatch_private.transfer_unanswered_watch_sos()'),/permission denied/),'anon');
  await assert.rejects(respond(due,'confirmed',outsider),error=>error.code==='42501');
  console.log('PASS family acknowledgment stops automatic transfer; receipts stay family-only and unauthorized accounts cannot run the worker or respond');
} catch (error) { console.error(JSON.stringify({ message: error.message, code: error.code, detail: error.detail, where: error.where })); process.exitCode=1; }
finally { await pg.close(); }

