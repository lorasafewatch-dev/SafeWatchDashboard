import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_PAGE_SIZE, activityHistoryError, activityStatus, activityTitle, loadActivityHistory } from './activityHistory.js';

test('activity filters and Philippine date range are sent to the server with stable cursor pagination', async () => {
  const rows=Array.from({length:101},(_,i)=>({event_id:`e:${i}`,occurred_at:'2026-11-03T01:00:00Z'}));
  let args;
  const client={rpc:async(name,parameters)=>{assert.equal(name,'get_watch_activity_history');args=parameters;return {data:rows};}};
  const options={day:'2026-11-03',deviceId:'watch',category:'alerts',alertType:'SOS'};
  const page=await loadActivityHistory(client,options);
  assert.equal(page.records.length,ACTIVITY_PAGE_SIZE);assert.equal(page.hasMore,true);
  assert.equal(args.p_start,'2026-11-02T16:00:00.000Z');assert.equal(args.p_end,'2026-11-03T16:00:00.000Z');
  assert.equal(args.p_device_id,'watch');assert.equal(args.p_alert_type,'SOS');
  await loadActivityHistory(client,options,page.cursor);
  assert.equal(args.p_before_id,'e:99');assert.equal(args.p_before_at,page.cursor.occurred_at);
  await loadActivityHistory(client,{day:options.day,category:'movements',alertType:'SOS'});
  assert.equal(args.p_alert_type,null);assert.equal(args.p_device_id,null);
});
test('activity errors remain distinguishable from empty history and requests support cancellation',async()=>{
  const error={code:'42501'};
  await assert.rejects(loadActivityHistory({rpc:async()=>({error})},{day:'2026-11-03'}),value=>value===error);
  assert.match(activityHistoryError(error),/Access is unavailable/);
  assert.match(activityHistoryError({code:'PGRST202'}),/database update/);
  assert.match(activityHistoryError(new Error('offline')),/could not be loaded/);
  const controller=new AbortController();let signal;
  const client={rpc:()=>({abortSignal:value=>{signal=value;return Promise.resolve({data:[]});}})};
  assert.deepEqual((await loadActivityHistory(client,{day:'2026-11-03'},null,controller.signal)).records,[]);
  assert.equal(signal,controller.signal);
});
test('saved snapshots and closed alerts have clear labels without performing alert actions',()=>{
  assert.equal(activityTitle({event_kind:'alert_snapshot'}),'Existing alert record');
  assert.equal(activityStatus({status:'ACKNOWLEDGED_FAMILY',details:{incident_open:false}}),'Confirmed by family · Closed');
  assert.equal(activityStatus({status:'ACKNOWLEDGED_BHW'}),'Confirmed by barangay');
});
