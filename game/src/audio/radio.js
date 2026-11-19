// LUMEN BAY radio: three original WebAudio synth stations, no audio files.
// Each station is a small step-sequencer (oscillator + gain envelopes) with its
// own waveform, tempo and track list. The AudioContext is created lazily and
// must be resumed from a user gesture before sound is heard.

const STATIONS = [
  {
    key: 'WAVE',
    freq: '88.1',
    name: 'Neon Drive',
    tempo: 0.16,        // seconds per 16th step
    waveform: 'sawtooth',
    bassWave: 'square',
    base: 220,          // A3-ish root for the arpeggio
    tracks: [
      'Midnight Circuit',
      'Chrome Avenues',
      'Palm Grid Overdrive',
    ],
    scale: [0, 3, 7, 10], // minor arpeggio intervals
  },
  {
    key: 'LAGOON',
    freq: '98.1',
    name: 'Tide Lines',
    tempo: 0.24,
    waveform: 'triangle',
    bassWave: 'sine',
    base: 165,
    tracks: [
      'Salt on the Wires',
      'Slow Ferry Home',
      'The Boardwalk Drift',
    ],
    scale: [0, 4, 7, 12],
  },
  {
    key: 'KSUN',
    freq: '91.7',
    name: 'Golden Hour',
    tempo: 0.14,
    waveform: 'sine',
    bassWave: 'triangle',
    base: 130,
    tracks: [
      'Dust on the Dash',
      'Sunset Disco',
      'Beachfront Fuzz',
    ],
    scale: [0, 5, 7, 10],
  },
];

/** Build a WebAudio synth radio. Muted until the first start()/next() from a
 *  user gesture; createRadio() itself makes no sound.
 *  API: start(), stop(), next(), current(), setMuted(m). */
export function createRadio() {
  // --radio-stations-- marker: station data above

  let ctx = null;        // AudioContext, created on first user gesture
  let master = null;     // gain node: setMuted flips its value
  let station = 0;       // current station index
  let running = false;
  let muted = false;
  let step = 0;          // sequencer step counter
  let nextNote = 0;      // AudioContext time of the next scheduled step
  let timerId = null;    // setInterval that drives scheduling
  let trackIndex = 0;    // which track name the current station is "playing"
  const rng = mulberry32(20261117);

  /** Deterministic PRNG so the radio grooves the same every session. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Lazily create the AudioContext; must be called from a user gesture so the
   *  browser lets it run. Returns true once audio is actually usable. */
  function ensureCtx() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    // A gentle low-pass on the master gives the synth a warm, lo-fi radio
    // tint and softens the harsh oscillator edges before the destination.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3400;
    tone.Q.value = 0.4;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.16;
    master.connect(tone);
    tone.connect(ctx.destination);
    return true;
  }

  /** Current station definition + track name, for the HUD widget. */
  function current() {
    const st = STATIONS[station];
    return {
      station: st.name,
      stationKey: st.key,
      freq: st.freq,
      track: st.tracks[trackIndex % st.tracks.length],
    };
  }

  /** Play one scheduled note on a dedicated osc + gain envelope.
   *  freqHz is the tone; the envelope attacks fast, then decays to give the
   *  synth a pluck or pad feel. Each station's waveform drives its mood. */
  function note(time, freqHz, dur, vol) {
    const osc = ctx.createOscillator();
    osc.type = STATIONS[station].waveform;
    osc.frequency.value = freqHz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  /** Play the bass note for a step, an octave below the root. */
  function bass(time, freqHz, dur) {
    const osc = ctx.createOscillator();
    osc.type = STATIONS[station].bassWave;
    osc.frequency.value = freqHz / 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.22, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  /** Advance the sequencer one 16th step, scheduling its notes ahead of time.
   *  An arpeggio pattern walks up and down the station's minor scale while the
   *  bass holds a root-fifth groove. Called from the scheduler interval. */
  function scheduleStep() {
    const st = STATIONS[station];
    const t = nextNote;
    const stepDur = st.tempo * 2;   // one step sounds for two 16th slots
    const root = st.base;
    const pattern = st.scale;
    const iv = pattern[step % pattern.length];
    const freq = root * Math.pow(2, iv / 12);

    // Pluck the arpeggio note on even 16th steps (a driving pulse), skip the
    // off-beats so it breathes instead of sounding like a machine gun. A small
    // PRNG wobble on the velocity keeps the loop from sounding too robotic.
    if (step % 2 === 0) {
      note(t, freq, stepDur, 0.14 + rng() * 0.06);
    }
    // A bass hit on the downbeat of every 4 steps keeps the groove grounded.
    if (step % 4 === 0) {
      bass(t, root, stepDur);
    }

    nextNote += st.tempo;
    step += 1;
    if (step >= 65536) step = 0; // wrap the counter harmlessly
  }

  /** Start the sequencer: ensure the AudioContext exists/resumes, then begin
   *  scheduling steps at a lookahead so notes never glitch on the interval. */
  function start() {
    if (!ensureCtx()) return;
    if (running) return;
    running = true;
    nextNote = ctx.currentTime + 0.08;
    // A tight 60ms interval checks how far ahead we are and tops up the queue.
    timerId = window.setInterval(() => {
      while (nextNote < ctx.currentTime + 0.2) scheduleStep();
    }, 60);
  }

  /** Stop the sequencer and silence the synth (mute is separate). */
  function stop() {
    if (timerId) { window.clearInterval(timerId); timerId = null; }
    running = false;
  }

  /** Jump straight to a station by index; wraps negatives so the HUD can
   *  cycle back without tracking the counter itself. */
  function setStation(i) {
    if (!ensureCtx()) return current();
    if (!running) start();
    station = ((i % STATIONS.length) + STATIONS.length) % STATIONS.length;
    step = 0;
    trackIndex = (trackIndex + 1) % STATIONS[station].tracks.length;
    nextNote = ctx.currentTime + 0.05;
    return current();
  }

  /** Cycle to the next station (wraps around) and return the new HUD tuple. */
  function next() {
    return setStation(station + 1);
  }

  /** Mute / unmute without stopping the scheduler. */
  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : 0.16;
  }

  return { start, stop, next, current, setMuted };
}