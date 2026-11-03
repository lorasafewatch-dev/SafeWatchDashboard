import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBellNotifications, loadReadNotifications, markNotificationsRead, notificationStorageKey, unreadNotifications } from './notificationCenter.js';

const at='2026-11-03T04:00:00Z';
const sos=(details={})=>({id:1,device_id:'watch-a',alert_type:'SOS',created_at:at,devices:{patient_name:'Test Senior'},details:{status:'PENDING_FAMILY',incident_open:true,...details}});
const receipt=(version=1,role='barangay',decision='confirmed')=>sos({status:decision==='confirmed'?role==='family'?'ACKNOWLEDGED_FAMILY':'ACKNOWLEDGED_BHW':'ESCALATED_BHW',sos_response_version:version,sos_response_at:at,sos_assigned_to:decision==='confirmed'?'none':role==='family'?'barangay':'family',sos_responses:{[role]:{decision,at,by:`${role}-user`}}});
function memoryStorage() { const data=new Map(); return {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)}; }

test('bell includes a secretary confirmation when no active alert remains',()=>{
  const notifications=buildBellNotifications([],[receipt()], 'family-user');
  assert.equal(notifications.length,1);
  assert.match(notifications[0].title,/Barangay secretary confirmed/);
  assert.equal(notifications[0].active,false);
  assert.equal(unreadNotifications(notifications).length,1);
});

test('both reciprocal handoffs and family confirmation appear in the bell',()=>{
  assert.match(buildBellNotifications([],[receipt(1,'family','declined')],'barangay-user')[0].message,/Family declined.*secretary notified/);
  assert.match(buildBellNotifications([],[receipt(1,'barangay','declined')],'family-user')[0].message,/secretary declined.*Family notified/);
  assert.match(buildBellNotifications([],[receipt(1,'family')],'barangay-user')[0].title,/Family confirmed/);
});

test('active SOS and its response feed merge into one notification',()=>{
  const declined=receipt(1,'family','declined');
  const notifications=buildBellNotifications([declined],[declined],'barangay-user');
  assert.equal(notifications.length,1); assert.equal(notifications[0].active,true);
});

test('a newer saved confirmation replaces an older pending snapshot, regardless of query completion order',()=>{
  const notifications=buildBellNotifications([sos()],[receipt(2)],'family-user');
  assert.equal(notifications.length,1); assert.equal(notifications[0].active,false);
  assert.match(notifications[0].title,/secretary confirmed/);
  const newer=receipt(3,'barangay','declined');
  assert.equal(buildBellNotifications([newer],[receipt(1,'family','declined')])[0].incident.details.sos_response_version,3);
});

test('read state survives reloads but each new SOS decision becomes unread again',()=>{
  const storage=memoryStorage(), key=notificationStorageKey('family','family-user');
  const first=buildBellNotifications([],[receipt(1,'barangay','declined')],'family-user');
  const read=markNotificationsRead([],first.map(item=>item.key),storage,key);
  assert.equal(unreadNotifications(first,read).length,0);
  assert.deepEqual(loadReadNotifications(storage,key),read);
  const confirmed=buildBellNotifications([],[receipt(2)],'family-user');
  assert.equal(unreadNotifications(confirmed,loadReadNotifications(storage,key)).length,1);
});

test('reading a notification does not mutate, confirm or decline the incident',()=>{
  const incident=sos(); const before=JSON.stringify(incident);
  const notifications=buildBellNotifications([incident],[]);
  const ids=markNotificationsRead([],notifications.map(item=>item.key));
  assert.equal(unreadNotifications(notifications,ids).length,0);
  assert.equal(notifications[0].active,true); assert.equal(JSON.stringify(incident),before);
});

test('repeat battery and watch packets do not reset read state',()=>{
  const battery={...sos(),id:2,alert_type:'LOW_BATTERY',details:{status:'PENDING_FAMILY',battery_percent:20}};
  const first=buildBellNotifications([battery],[]);
  const later=buildBellNotifications([{...battery,details:{...battery.details,battery_percent:15,last_seen_at:'2026-11-03T04:01:00Z'}}],[]);
  assert.equal(first[0].key,later[0].key);
  assert.equal(unreadNotifications(later,[first[0].key]).length,0);
  assert.match(later[0].message,/15%/);
});

test('own decisions are visible without showing them as unread to the same user',()=>{
  const notifications=buildBellNotifications([],[receipt()], 'barangay-user');
  assert.equal(notifications.length,1); assert.equal(unreadNotifications(notifications).length,0);
  assert.equal(unreadNotifications(buildBellNotifications([],[receipt()], 'another-staff-user')).length,1);
});

test('rapid decisions within the same millisecond still notify the correct recipient',()=>{
  const confirmed=receipt(2);
  confirmed.details.sos_responses.family={decision:'declined',at:'2026-11-03T04:00:00.000100Z',by:'family-user'};
  confirmed.details.sos_responses.barangay={decision:'confirmed',at:'2026-11-03T04:00:00.000200Z',by:'barangay-user'};
  confirmed.details.sos_response_at='2026-11-03T04:00:00.000200Z';
  assert.equal(unreadNotifications(buildBellNotifications([],[confirmed],'family-user')).length,1);
  assert.equal(unreadNotifications(buildBellNotifications([],[confirmed],'barangay-user')).length,0);
});

test('active SOS has priority, distinct seniors stay separate, and mark all read covers the full list',()=>{
  const notifications=buildBellNotifications([sos(),{...sos(),device_id:'watch-b'}, {...sos(),id:3,alert_type:'GEOFENCE'}],[{...receipt(),id:4}]);
  assert.equal(notifications.length,4); assert.equal(notifications[0].incident.alert_type,'SOS');
  assert.equal(unreadNotifications(notifications,markNotificationsRead([],notifications.map(item=>item.key))).length,0);
});

test('read storage is isolated by account/app and recovers from blocked or invalid storage',()=>{
  assert.notEqual(notificationStorageKey('family','a'),notificationStorageKey('family','b'));
  assert.notEqual(notificationStorageKey('family','a'),notificationStorageKey('barangay','a'));
  assert.equal(notificationStorageKey('family',null),null);
  assert.deepEqual(loadReadNotifications({getItem:()=>'{broken'},'key'),[]);
  assert.deepEqual(loadReadNotifications({getItem:()=>'{"not":"an array"}'},'key'),[]);
  assert.deepEqual(markNotificationsRead([],['read'],{setItem(){throw new Error('blocked');}},'key'),['read']);
});
