import test from 'node:test';
import assert from 'node:assert/strict';
import { enableAlertSounds, playAlertSound, stopAlertSounds } from './alertSound.js';

const oscillators = [];
let audio;
globalThis.window = { AudioContext: class {
  constructor() { this.state = 'suspended'; this.currentTime = 0; audio = this; }
  async resume() { this.state = 'running'; }
  createGain() { return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}; }
  createOscillator() {
    const oscillator = {frequency:{value:0},stops:[],connect(){},disconnect(){},start(){},stop(at){this.stops.push(at);}};
    oscillators.push(oscillator);
    return oscillator;
  }
} };

test('blocked browser audio schedules nothing until explicitly unlocked', async () => {
  assert.equal(playAlertSound('sos'),false);
  assert.equal(oscillators.length,0);
  assert.equal(await enableAlertSounds(),true);
  assert.equal(audio.state,'running');
});

test('new notifications replace pending notes, and confirmation cancels all SOS notes', () => {
  assert.equal(playAlertSound('geofence'),true);
  const first = oscillators.slice();
  assert.equal(first.length,2);
  assert.equal(playAlertSound('sos'),true);
  assert.ok(first.every(oscillator=>oscillator.stops.at(-1)===undefined));
  const sos = oscillators.slice(2);
  assert.equal(sos.length,3);
  stopAlertSounds();
  assert.ok(sos.every(oscillator=>oscillator.stops.at(-1)===undefined));
  const counts = sos.map(oscillator=>oscillator.stops.length);
  stopAlertSounds();
  assert.deepEqual(sos.map(oscillator=>oscillator.stops.length),counts);
});
