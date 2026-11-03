import test from 'node:test';
import assert from 'node:assert/strict';
import { clearPrivateBrowserCache, installPrivateCacheCleanup } from './privateCache.js';

function storage() {
  const data=new Map([['safewatch.family.alerts.v1:a','private'],['safewatch.family.selected-senior.v1:a','watch'],['safewatch.barangay.alerts.v1:a','staff'],['safewatch.family.notifications.v1:a','family reads'],['safewatch.barangay.notifications.v1:a','staff reads'],['unrelated-preference','keep']]);
  return { get length(){return data.size;},key:index=>[...data.keys()][index],removeItem:key=>data.delete(key),has:key=>data.has(key) };
}
test('sign-out removes family alert/watch metadata from both storage types without deleting unrelated app settings',()=>{
  const browser={localStorage:storage(),sessionStorage:storage()};
  clearPrivateBrowserCache('family',browser);
  for(const current of Object.values(browser)) {
    assert.equal(current.has('safewatch.family.alerts.v1:a'),false);
    assert.equal(current.has('safewatch.family.selected-senior.v1:a'),false);
    assert.equal(current.has('safewatch.barangay.alerts.v1:a'),true);
    assert.equal(current.has('safewatch.family.notifications.v1:a'),false);
    assert.equal(current.has('safewatch.barangay.notifications.v1:a'),true);
    assert.equal(current.has('unrelated-preference'),true);
  }
});

test('barangay sign-out clears its bell read state without clearing family state',()=>{
  const browser={localStorage:storage(),sessionStorage:storage()};
  clearPrivateBrowserCache('dashboard',browser);
  for (const current of Object.values(browser)) {
    assert.equal(current.has('safewatch.barangay.notifications.v1:a'),false);
    assert.equal(current.has('safewatch.family.notifications.v1:a'),true);
  }
});
test('unavailable storage cannot prevent sign-out and cleanup only reacts to SIGNED_OUT',()=>{
  clearPrivateBrowserCache('family',{get localStorage(){throw new Error('blocked');}});
  let listener;installPrivateCacheCleanup({auth:{onAuthStateChange:fn=>{listener=fn;}}},'family');
  assert.doesNotThrow(()=>listener('SIGNED_IN'));
  assert.doesNotThrow(()=>listener('SIGNED_OUT'));
});
