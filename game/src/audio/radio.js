// LUMEN BAY radio: three original WebAudio synth stations, no audio files.
// Each station is a small step-sequencer (oscillator + gain envelopes) with its
// own waveform, tempo and track list. The AudioContext is created lazily and
// must be resumed from a user gesture before sound is heard — Rook's radio
// only comes on after the player has interacted with the page at least once.
//
// P3 thickness: an off-beat noise hat and a low detuned-sine pad join the
// pluck + bass, each track sits on its own root, and the master sits at 0.25
// with a 0..1 volume model so the settings slider scales instead of muting.

// --- Shared AudioContext bus ----------------------------------------------
// A page should only ever own one AudioContext. Whichever of radio / sfx
// gets there first creates it; the other reuses it through these helpers.
let sharedCtx = null;

/** The live shared AudioContext, or null before anyone has created one. */
export function audioContext() {
  return sharedCtx;
}

/** Register a context as the shared one (first writer wins); returns it. */
export function shareAudioContext(c) {
  if (c && !sharedCtx) sharedCtx = c;
  return sharedCtx;
}

/** Master radio level at full volume (was 0.16 before P3). */
const BASE_GAIN = 0.25;

const STATIONS = [
  {
    key: 'WAVE',
    freq: '88.1',
    name: 'Neon Drive',
    tempo: 0.16,        // seconds per 16th step
    waveform: 'sawtooth',
    bassWave: 'square',
    base: 220,          // A3-ish root for the arpeggio
    trackShift: [0, 3, -2],   // per-track root offsets in semitones
    hatVol: 0.055,      // driving off-beat tick
    padVol: 0.04,
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
    trackShift: [0, -2, 5],
    hatVol: 0.03,       // softer, sparser tick for the slow station
    padVol: 0.05,       // the pad carries this station's warmth
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
    trackShift: [0, 2, -3],
    hatVol: 0.045,
    padVol: 0.045,
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
 *  API: start(), stop(), next(), current(), setMuted(m).
 *  setMuted accepts a boolean (mute/unmute) OR a 0..1 volume number, so the
 *  settings slider can scale the radio instead of hard-muting it. */
export function createRadio() {
  // --radio-stations-- marker: station data above

  let ctx = null;        // AudioContext, created on first user gesture
  let master = null;     // gain node: setMuted sets its value
  let station = 0;       // current station index
  let running = false;
  let muted = false;
  let level = 1;         // 0..1 volume from the settings slider
  let step = 0;          // sequencer step counter
  let nextNote = 0;      // AudioContext time of the next scheduled step
  let timerId = null;    // setInterval that drives scheduling
  let trackIndex = 0;    // which track name the current station is "playing"
  let noiseBuf = null;   // shared white-noise buffer for the hat
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
   *  browser lets it run. Returns true once audio is actually usable. Reuses
   *  the shared context when sfx.js already created one. */
  function ensureCtx() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = audioContext() || new AC();
    shareAudioContext(ctx);
    // A gentle low-pass on the master gives the synth a warm, lo-fi radio
    // tint and softens the harsh oscillator edges before the destination.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3400;
    tone.Q.value = 0.4;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : BASE_GAIN * level;
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

  /** One second of white noise from the station PRNG (deterministic), built
   *  once and shared by every hat tick. */
  function noise() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ctx.sampleRate);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = rng() * 2 - 1;
    return noiseBuf;
  }

  /** Off-beat hat: a tiny high-passed noise tick, per-station velocity. */
  function hat(time, vol) {
    const src = ctx.createBufferSource();
    src.buffer = noise();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6500;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(time);
    src.stop(time + 0.08);
  }

  /** Pad: two detuned sines on the chord root (plus a soft fifth) with a
   *  slow attack, low gain — the warm bed under the pluck and bass. */
  function pad(time, rootHz, dur, vol) {
    const parts = [
      { f: rootHz * 0.9975, v: vol },        // ~-4 cents
      { f: rootHz * 1.0025, v: vol },        // ~+4 cents
      { f: rootHz * Math.pow(2, 7 / 12), v: vol * 0.5 }, // fifth above
    ];
    for (const p of parts) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = p.f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(p.v, time + Math.min(0.25, dur * 0.3));
      g.gain.setValueAtTime(p.v, time + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    }
  }

  /** Advance the sequencer one 16th step, scheduling its notes ahead of time.
   *  An arpeggio pattern walks up and down the station's minor scale while the
   *  bass holds a root-fifth groove, the hat ticks the off-beats and a pad
   *  swells once per bar on a slowly moving chord root. Each track sits on
   *  its own root (trackShift), so the three tracks never share one base. */
  function scheduleStep() {
    const st = STATIONS[station];
    const t = nextNote;
    const stepDur = st.tempo * 2;   // one step sounds for two 16th slots
    // Per-track root: the station base transposed by this track's offset.
    const shift = st.trackShift[trackIndex % st.trackShift.length];
    const root = st.base * Math.pow(2, shift / 12);
    const pattern = st.scale;
    const iv = pattern[step % pattern.length];
    const freq = root * Math.pow(2, iv / 12);

    // Pluck the arpeggio note on even 16th steps (a driving pulse), skip the
    // off-beats so it breathes instead of sounding like a machine gun. A small
    // PRNG wobble on the velocity keeps the loop from sounding too robotic.
    if (step % 2 === 0) {
      note(t, freq, stepDur, 0.14 + rng() * 0.06);
    } else {
      // Off-beat hat tick. Tide Lines keeps it sparse (every other off-beat)
      // so the slow station stays laid back; the others tick every off-beat.
      if (st.key !== 'LAGOON' || step % 4 === 3) {
        hat(t, st.hatVol * (0.8 + rng() * 0.4));
      }
    }
    // A bass hit on the downbeat of every 4 steps keeps the groove grounded;
    // alternating root and fifth gives it a little walk.
    if (step % 4 === 0) {
      const bassHz = step % 8 === 4 ? root * Math.pow(2, 7 / 12) : root;
      bass(t, bassHz, stepDur);
    }
    // Pad swell once per 16-step bar on a i-VI-III-VII style root movement.
    if (step % 16 === 0) {
      const bar = Math.floor(step / 16);
      const chordIv = [0, -4, 3, -2][bar % 4];
      pad(t, root * Math.pow(2, chordIv / 12), st.tempo * 16, st.padVol);
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
    // Guarded: a scheduling glitch must never kill the timer (or the game).
    timerId = window.setInterval(() => {
      try {
        while (nextNote < ctx.currentTime + 0.2) scheduleStep();
      } catch {
        /* skip this top-up; the next interval retries */
      }
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

  /** Mute / unmute, or set a 0..1 volume. Boolean keeps the old semantics
   *  (true = mute, false = unmute at the current level); a number sets the
   *  level directly (0 mutes), so the settings slider scales the radio. */
  function setMuted(m) {
    if (typeof m === 'number' && Number.isFinite(m)) {
      level = Math.max(0, Math.min(1, m));
      muted = level <= 0;
    } else {
      muted = !!m;
    }
    if (master) master.gain.value = muted ? 0 : BASE_GAIN * level;
  }

  return { start, stop, next, current, setMuted };
}
