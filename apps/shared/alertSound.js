let context;
const playing = new Set();

export function stopAlertSounds() {
  for (const oscillator of playing) {
    try { oscillator.stop(); } catch { /* It may have finished already. */ }
  }
  playing.clear();
}

function getContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!context || context.state === 'closed') context = new AudioContext();
  return context;
}

export async function enableAlertSounds() {
  try {
    const audio = getContext();
    if (!audio) return false;
    if (audio.state === 'suspended') await audio.resume();
    return audio.state === 'running';
  } catch { return false; }
}

export function playAlertSound(type = 'geofence') {
  try {
    const audio = getContext();
    if (!audio || audio.state !== 'running') return false;
    stopAlertSounds();
    const notes = type === 'sos' ? [[880, 0, .14], [880, .28, .14], [880, .56, .24]]
      : type === 'reminder' ? [[740, 0, .12], [988, .20, .18]]
      : [[523.25, 0, .20], [659.25, .24, .32]];
    for (const [frequency, offset, duration] of notes) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + offset;
      oscillator.type = type === 'sos' ? 'square' : 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      gain.connect(audio.destination);
      gain.gain.setValueAtTime(.001, start);
      gain.gain.exponentialRampToValueAtTime(type === 'sos' ? .18 : .12, start + .015);
      gain.gain.exponentialRampToValueAtTime(.001, start + duration);
      oscillator.start(start);
      oscillator.stop(start + duration + .02);
      playing.add(oscillator);
      oscillator.onended = () => { playing.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    }
    return true;
  } catch { return false; }
}
