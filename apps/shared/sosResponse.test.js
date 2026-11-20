import test from 'node:test';
import assert from 'node:assert/strict';
import { groupAlertIncidents, needsBarangayAttention, planAlertSounds } from './alertLifecycle.js';
import { barangaySosStage, isFamilyActionable, loadSosResponses, markSosArrived, mergeSosResponse, respondToSos, sosResponseState } from './sosResponse.js';

const now = Date.parse('2026-11-03T04:00:00Z');
const row = (details = {}) => ({ id: 1, device_id: 'watch-a', alert_type: 'SOS', created_at: new Date(now).toISOString(),
  details: { status: 'PENDING_FAMILY', incident_open: true, first_seen_at: new Date(now).toISOString(), ...details } });

test('a family-first SOS stays with family until a server handoff receipt exists', () => {
  const pending=row({sos_family_first:true,sos_assigned_to:'family'});
  assert.equal(needsBarangayAttention(pending,now+900000),false);
  assert.equal(sosResponseState(pending).waitingForFamily,true);
  assert.equal(sosResponseState(pending).message,'Waiting for family response');
  const transferred=row({sos_family_first:true,sos_assigned_to:'barangay',sos_transferred_at:new Date(now+180000).toISOString(),sos_transfer_reason:'automatic_timeout'});
  assert.equal(needsBarangayAttention(transferred,now+180000),true);
  assert.equal(sosResponseState(transferred).waitingForFamily,false);
  assert.equal(isFamilyActionable(transferred),false);
  assert.match(sosResponseState(transferred).message,/No family response after 3 minutes/);
});

test('family decline immediately notifies barangay even before the response window and after another watch packet', () => {
  const declined = row({ sos_assigned_to: 'barangay', sos_response_version: 1, sos_responses: { family: { decision: 'declined' } } });
  assert.equal(needsBarangayAttention(declined, now), true);
  assert.equal(isFamilyActionable(declined), false);
  assert.match(sosResponseState(declined).message, /Family declined.*secretary notified/);
});

test('secretary decline hands SOS to family instead of sending it back to staff on an expired timer', () => {
  const declined = row({ status: 'ESCALATED_BHW', sos_assigned_to: 'family', sos_response_version: 1,
    sos_responses: { barangay: { decision: 'declined' } } });
  assert.equal(needsBarangayAttention(declined, now+900000), false);
  assert.equal(isFamilyActionable(declined), true);
  assert.match(sosResponseState(declined).message, /secretary declined.*Family notified/);
});

test('both declining keeps the SOS visible to both, while either confirmation ends action requests', () => {
  const both = row({ sos_assigned_to: 'both', sos_responses: { family: { decision: 'declined' }, barangay: { decision: 'declined' } } });
  assert.equal(needsBarangayAttention(both, now), true);
  assert.equal(isFamilyActionable(both), true);
  assert.match(sosResponseState(both).message, /Both sides declined/);
  for (const status of ['ACKNOWLEDGED_FAMILY','ACKNOWLEDGED_BHW']) {
    const confirmed = row({ status, sos_assigned_to: 'none' });
    assert.equal(groupAlertIncidents([confirmed]).length, 0);
    assert.equal(needsBarangayAttention(confirmed, now), false);
    assert.equal(sosResponseState(confirmed).confirmed, true);
  }
});

test('response versions re-notify the receiving party exactly once and repeated telemetry stays silent', () => {
  const [initial] = groupAlertIncidents([row()]);
  const firstSounds = planAlertSounds([initial], {}, now);
  const [returned] = groupAlertIncidents([row({ sos_assigned_to: 'family', sos_response_version: 2 })]);
  assert.notEqual(initial.key, returned.key);
  const handoffSounds = planAlertSounds([returned], firstSounds.ledger, now);
  assert.equal(handoffSounds.events.length, 1); assert.equal(handoffSounds.events[0].tone, 'sos');
  const [packet] = groupAlertIncidents([row({ sos_assigned_to: 'family', sos_response_version: 2, update_count: 99 })]);
  assert.equal(planAlertSounds([packet], handoffSounds.ledger, now).events.length, 0);
});

test('confirmation indicators retain who confirmed and both sides decisions across reloads', () => {
  const incident = row({ status: 'ACKNOWLEDGED_BHW', sos_assigned_to: 'none', sos_responses: {
    family: { decision: 'declined', at: new Date(now).toISOString() },
    barangay: { decision: 'confirmed', at: new Date(now+1000).toISOString() },
  } });
  const state = sosResponseState(JSON.parse(JSON.stringify(incident)));
  assert.equal(state.responses.family.decision, 'declined');
  assert.equal(state.responses.barangay.decision, 'confirmed');
  assert.equal(state.message, 'Barangay personnel are on the way');
  assert.match(sosResponseState(row({ status: 'ACKNOWLEDGED_FAMILY' })).message, /Family confirmed/);
});

test('closed legacy acknowledgments stay historical while a transferred response can await arrival with the watch signal off', () => {
  const at = new Date(now).toISOString();
  const closed = row({ status: 'ACKNOWLEDGED_BHW', incident_open: false, acknowledged_at: at,
    sos_response_at: at, sos_responses: { barangay: { decision: 'confirmed', at } } });
  assert.equal(barangaySosStage(closed), null);
  assert.equal(sosResponseState(closed).message, 'Barangay secretary confirmed the response');
  const transferred = { ...closed, details: { ...closed.details, sos_transferred_at: at } };
  assert.equal(barangaySosStage(transferred), 'on_the_way');
  assert.equal(barangaySosStage({ ...transferred, details: { ...transferred.details, resolved_at: at } }), null);
  assert.equal(barangaySosStage({ ...closed, details: { ...closed.details, sos_arrived_at: at } }), 'arrived');
});

test('arrival requires a saved receipt on the accepted SOS', async () => {
  const accepted = row({ status: 'ACKNOWLEDGED_BHW', acknowledged_at: new Date(now).toISOString() });
  const arrived = { ...accepted, details: { ...accepted.details, sos_arrived_at: new Date(now + 1000).toISOString() } };
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'mark_sos_arrived');
    assert.deepEqual(args, { p_alert_id: accepted.id });
    return { data: { saved: true, alert: arrived } };
  } };
  assert.equal(sosResponseState(await markSosArrived(client, accepted)).message, 'Barangay personnel have arrived');
  await assert.rejects(markSosArrived(client, row()), /must accept/);
  await assert.rejects(markSosArrived({ rpc: async () => ({ data: { saved: true, alert: accepted } }) }, accepted), /not saved/);
});

test('response writes validate the saved alert and role instead of treating an unsuccessful RPC as confirmation', async () => {
  const incident = row(); let called;
  const client = { rpc: async (name, args) => { called = {name,args}; return { data: { saved: true, alert: row({ status: 'ACKNOWLEDGED_FAMILY' }) } }; } };
  await respondToSos(client, incident, 'confirmed');
  assert.deepEqual(called, { name: 'respond_to_sos', args: { p_alert_id: 1, p_decision: 'confirmed', p_role: 'family' } });
  await respondToSos(client, incident, 'declined', 'barangay'); assert.equal(called.args.p_role, 'barangay');
  for (const data of [null, {saved:false}, {saved:true,alert:{...incident,id:2}}, {saved:true,alert:{...incident,device_id:'another'}}]) {
    await assert.rejects(respondToSos({rpc:async()=>({data})},incident,'confirmed'));
  }
  const denied = { code: '42501' };
  await assert.rejects(respondToSos({rpc:async()=>({error:denied})},incident,'declined'), error=>error===denied);
  await assert.rejects(respondToSos(client,incident,'dismiss'));
  await assert.rejects(respondToSos(client,{...incident,alert_type:'GEOFENCE'},'declined'));
});

test('response feed stays separate from active incidents and optimistically merges one receipt per alert', async () => {
  const receipt = row({ status: 'ACKNOWLEDGED_FAMILY' });
  const loaded = await loadSosResponses({rpc:async(name,args)=>{
    assert.equal(name,'list_sos_response_updates'); assert.equal(args.p_limit,50);
    return {data:[{...receipt,patient_name:'Test Senior'}]};
  }});
  assert.equal(loaded[0].devices.patient_name,'Test Senior');
  const merged = mergeSosResponse([receipt,{...receipt,id:2}], {...receipt,details:{status:'ACKNOWLEDGED_BHW'}});
  assert.equal(merged.length,2); assert.equal(merged[0].details.status,'ACKNOWLEDGED_BHW');
});
