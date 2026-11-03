import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgeIncident, alertClock, confirmationErrorMessage, groupAlertIncidents, incidentSnapshot, needsBarangayAttention, planAlertSounds, requestFamilySos } from './alertLifecycle.js';

const start = Date.parse('2026-10-09T06:00:00Z');
const row = (id, seconds = 0, overrides = {}) => ({ id, device_id: 'watch-a',
  alert_type: 'GEOFENCE', created_at: new Date(start + seconds * 1000).toISOString(),
  devices: { device_name: 'Watch', patient_name: 'Test Person' }, ...overrides });

test('repeated outside packets produce one incident with the first deadline and newest update', () => {
  const [incident] = groupAlertIncidents([row(3, 20), row(1), row(2, 10)]);
  assert.equal(incident.id, 1);
  assert.equal(incident.updateCount, 3);
  assert.equal(incident.details.last_seen_at, row(3, 20).created_at);
  assert.deepEqual(incident.memberIds, [1, 2, 3]);
  assert.equal(alertClock(incident, start + 90000).remainingSeconds, 90);
});

test('the deadline and notification identity survive a rolling query window and a reload', () => {
  const original = groupAlertIncidents([row(1), row(2, 10)]);
  const memory = JSON.parse(JSON.stringify(incidentSnapshot(original)));
  const [updated] = groupAlertIncidents([row(40, 160), row(41, 170)], memory);
  assert.equal(updated.key, original[0].key);
  assert.equal(alertClock(updated, start + 170000).remainingSeconds, 10);
});

test('different people and a separate SOS remain distinct; SOS takes priority', () => {
  const incidents = groupAlertIncidents([row(1), row(2, 5, { alert_type: 'SOS' }), row(3, 8, {device_id:'watch-b'})]);
  assert.equal(incidents.length, 3);
  assert.equal(incidents[0].alert_type, 'SOS');
});

test('legacy geofence mute never hides SOS', () => {
  const devices = { device_name: 'Watch [MUTED]' };
  const incidents = groupAlertIncidents([row(1, 0, {devices}), row(2, 2, {devices, alert_type:'SOS'})]);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].alert_type, 'SOS');
});

test('returning to the zone rearms a new departure without clearing an SOS', () => {
  const incidents = groupAlertIncidents([row(1), row(2, 5, {alert_type:'SOS'}),
    row(3, 20, {alert_type:'RESOLVE_GEOFENCE'}), row(4, 30)]);
  assert.equal(incidents.length, 2);
  assert.equal(incidents.find(item => item.alert_type === 'GEOFENCE').id, 4);
});

test('confirmed, resolved and merged history is not presented as a new incident', () => {
  assert.deepEqual(groupAlertIncidents(['ACKNOWLEDGED_FAMILY','RESOLVED','MERGED'].map((status,index)=>row(index+1,0,{details:{status}}))), []);
});

test('an explicit new server incident overrides an older cached departure', () => {
  const old = incidentSnapshot(groupAlertIncidents([row(1)]));
  const fresh = row(2, 300, {details:{first_seen_at:row(2,300).created_at, incident_open:true}});
  const [incident] = groupAlertIncidents([fresh], old);
  assert.equal(incident.id, 2);
  assert.equal(alertClock(incident, start + 301000).remainingSeconds, 179);
});

test('a manually requested SOS is kept separate from another manual SOS', () => {
  assert.equal(groupAlertIncidents([row(1,0,{alert_type:'SOS',details:{source:'family_app'}}),
    row(2,10,{alert_type:'SOS',details:{source:'family_app'}})]).length, 2);
});

test('one initial chime and exactly one reminder, even after repeated polls and reload', () => {
  const incidents = groupAlertIncidents([row(1)]);
  const initial = planAlertSounds(incidents, {}, start);
  assert.deepEqual(initial.events.map(event=>event.tone), ['geofence']);
  assert.equal(planAlertSounds(incidents, initial.ledger, start+140000).events.length, 0);
  const reminder = planAlertSounds(incidents, initial.ledger, start+150000);
  assert.deepEqual(reminder.events.map(event=>event.tone), ['reminder']);
  const restored = JSON.parse(JSON.stringify(reminder.ledger));
  assert.equal(planAlertSounds(incidents, restored, start+151000).events.length, 0);
  assert.equal(planAlertSounds(incidents, restored, start+180000).events.length, 0);
  assert.equal(alertClock(incidents[0], start+180000).escalated, true);
});

test('an alert first discovered late has one sound rather than a double notification', () => {
  const incidents = groupAlertIncidents([row(1)]);
  const result = planAlertSounds(incidents, {}, start+165000);
  assert.equal(result.events.length, 1);
  assert.equal(planAlertSounds(incidents, result.ledger, start+166000).events.length, 0);
});

test('failed or denied confirmations are not treated as saved', async () => {
  const [incident] = groupAlertIncidents([row(1)]);
  await assert.rejects(acknowledgeIncident({rpc:async()=>({data:null,error:new Error('network failed')})},incident), /network failed/);
  await assert.rejects(acknowledgeIncident({rpc:async()=>({data:false,error:null})},incident), /changed before confirmation/);
});

test('a server-confirmed incident uses its stable ID and does not globally mute the watch', async () => {
  const [incident] = groupAlertIncidents([row(1)]);
  let request;
  const client = {rpc:async(name,args)=>{request={name,args};return{data:true,error:null};},
    from:()=>{throw new Error('Unexpected global device mutation');}};
  await acknowledgeIncident(client,incident);
  assert.deepEqual(request,{name:'acknowledge_alert_incident',args:{p_alert_id:1,p_role:'family'}});
});

test('family confirmation removes an expired incident from barangay attention and all later sounds', () => {
  const pending = row(1, 0, {details:{incident_open:true,status:'PENDING_FAMILY',first_seen_at:row(1).created_at}});
  assert.equal(needsBarangayAttention(pending,start+179000),false);
  assert.equal(needsBarangayAttention(pending,start+180000),true);
  const confirmed = {...pending,details:{...pending.details,status:'ACKNOWLEDGED_FAMILY'}};
  assert.equal(needsBarangayAttention(confirmed,start+360000),false);
  const incidents = groupAlertIncidents([confirmed]);
  assert.equal(incidents.length,0);
  assert.equal(planAlertSounds(incidents,{},start+360000).events.length,0);
});

test('missing confirmation RPC is reported without mutating or globally muting a watch', async () => {
  const [incident] = groupAlertIncidents([row(1)]);
  const error = {code:'PGRST202',message:'missing RPC'};
  const client = {rpc:async()=>({data:null,error}),from:()=>{throw new Error('Unexpected fallback write');}};
  await assert.rejects(acknowledgeIncident(client,incident),error);
  assert.match(confirmationErrorMessage(error),/database update/);
});

test('an independent fresh SOS still reaches the barangay after the response window', () => {
  const incidents = groupAlertIncidents([row(1,0,{details:{status:'ACKNOWLEDGED_FAMILY',incident_open:true}}),
    row(2,300,{alert_type:'SOS',details:{status:'PENDING_FAMILY',first_seen_at:row(2,300).created_at,incident_open:true}})]);
  assert.equal(incidents.length,1);
  assert.equal(needsBarangayAttention(incidents[0],start+479000),false);
  assert.equal(needsBarangayAttention(incidents[0],start+480000),true);
});

test('manual SOS uses a checked server response rather than ignoring an insert error', async () => {
  let request;
  assert.equal(await requestFamilySos({rpc:async(name,args)=>{request={name,args};return{data:42,error:null};}},'watch-a'),42);
  assert.deepEqual(request,{name:'request_family_sos',args:{p_device_id:'watch-a'}});
  await assert.rejects(requestFamilySos({rpc:async()=>({data:null,error:new Error('write denied')})},'watch-a'),/write denied/);
});
