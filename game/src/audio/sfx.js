// LUMEN BAY SFX: every sound synthesized in WebAudio — no audio assets, no
// network, the game stays offline/static. Shares the radio's AudioContext
// when one already exists (a page should only ever own one context);
// otherwise it creates its own lazily on first use, exactly like radio.js.
//
// One-shots go through play(name, opts): gunshot, enemyShot, impact, crash,
// horn, pickup, click, reload, missionClear, skid. Continuous layers are
// gated by setEngine(speedKmh, throttle, boost) / stopEngine(),
// setSkid(on) and setSiren(on) — the caller owns their lifecycle.
//
// Every entry point is guarded: with no WebAudio, or before the first user
// gesture has unlocked the context, calls silently no-op and never throw.
import { audioContext, shareAudioContext } from './radio.js';

let ctx = null;        // AudioContext, shared with the radio when possible
let master = null;     // sfx bus -> destination (independent of radio volume)
let noiseBuf = null;   // one second of deterministic white noise, reused
let lastCrash = -1;    // rate-limit: scraping a wall must not machine-gun

// Modest bus level: individual envelopes peak well below 1.0 so a gunshot
// landing on top of the radio and the engine never clips the destination.
const MASTER_VOL = 0.5;

/** Lazily create/reuse the AudioContext and the sfx bus. Returns false when
 *  audio is unavailable; a suspended context is resumed if the browser lets
 *  us (only a user gesture can unlock it — until then everything is silent). */
function ensureCtx() {
  try {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = audioContext() || new AC();
    shareAudioContext(ctx);
    master = ctx.createGain();
    master.gain.value = MASTER_VOL;
    master.connect(ctx.destination);
    return true;
  } catch {
    return false;
  }
}

/** One second of white noise from a tiny LCG (deterministic, like the rest
 *  of the game — no Math.random draws). Built once per context. */
function noise() {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ctx.sampleRate);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let s = 123456789;
  for (let i = 0; i < len; i += 1) {
    s = (s * 16807) % 2147483647;
    d[i] = (s / 2147483647) * 2 - 1;
  }
  return noiseBuf;
}

/** Fast attack, exponential decay to silence — the shared one-shot shape. */
function env(g, t, peak, dur, attack = 0.005) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
}

/** A filtered noise burst: the body of gunshots, crashes, skids, clicks. */
function burst(t, dur, peak, filterType, freq, q = 0.8) {
  const src = ctx.createBufferSource();
  src.buffer = noise();
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, peak, dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** An enveloped oscillator with an optional pitch sweep (f0 -> f1). */
function tone(t, type, f0, f1, dur, peak) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, peak, dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Play a one-shot by name. opts.vol scales the whole sound (0..1-ish);
 *  opts.weapon flavours the gunshot ('pistol' | 'smg' | 'shotgun').
 *  Unknown names and unavailable audio are silent no-ops. */
export function play(name, opts = {}) {
  if (!ensureCtx()) return;
  try {
    const t = ctx.currentTime + 0.001;
    const vol = opts.vol != null ? opts.vol : 1;
    switch (name) {
      case 'gunshot': {
        // Noise crack + a low thump. Shotgun: darker, heavier; SMG: lighter,
        // shorter so an 11 rps burst stays punchy instead of peaking.
        const w = opts.weapon || 'pistol';
        if (w === 'shotgun') {
          burst(t, 0.16, 0.5 * vol, 'lowpass', 950);
          tone(t, 'sine', 120, 42, 0.2, 0.5 * vol);
        } else if (w === 'smg') {
          burst(t, 0.07, 0.26 * vol, 'lowpass', 3200);
          tone(t, 'sine', 170, 70, 0.09, 0.22 * vol);
        } else {
          burst(t, 0.1, 0.4 * vol, 'lowpass', 2400);
          tone(t, 'sine', 150, 58, 0.12, 0.34 * vol);
        }
        break;
      }
      case 'enemyShot':
        // Distant return fire: quieter, thinner, no chest thump.
        burst(t, 0.08, 0.13 * vol, 'lowpass', 1700);
        tone(t, 'sine', 190, 80, 0.08, 0.1 * vol);
        break;
      case 'impact':
        // Dull thud for rounds landing on Rook.
        tone(t, 'sine', 95, 48, 0.18, 0.32 * vol);
        burst(t, 0.06, 0.12 * vol, 'lowpass', 500);
        break;
      case 'crash': {
        // Low noise thump on a hard collision; rate-limited so sliding
        // along a building face reads as one scrape, not a drum roll.
        if (ctx.currentTime - lastCrash < 0.3) return;
        lastCrash = ctx.currentTime;
        burst(t, 0.3, 0.45 * vol, 'lowpass', 320);
        tone(t, 'sine', 70, 34, 0.3, 0.4 * vol);
        break;
      }
      case 'horn':
        // Short square-wave honk, softened by the modest envelope.
        tone(t, 'square', 370, 370, 0.2, 0.11 * vol);
        break;
      case 'pickup':
        // Two-note blip: shells and job payouts.
        tone(t, 'triangle', 660, 660, 0.08, 0.15 * vol);
        tone(t + 0.08, 'triangle', 990, 990, 0.12, 0.15 * vol);
        break;
      case 'click':
        // Tiny UI tick for menu / pause buttons.
        tone(t, 'triangle', 1300, 900, 0.035, 0.08 * vol);
        break;
      case 'reload':
        // Two quick mechanical clicks: mag out, mag in.
        burst(t, 0.03, 0.12 * vol, 'bandpass', 2200, 2);
        burst(t + 0.09, 0.03, 0.12 * vol, 'bandpass', 1800, 2);
        break;
      case 'missionClear': {
        // Short rising 4-note jingle (C5 E5 G5 C6), last note held.
        const notes = [523.25, 659.25, 783.99, 1046.5];
        for (let i = 0; i < notes.length; i += 1) {
          tone(t + i * 0.11, 'triangle', notes[i], notes[i], i === 3 ? 0.34 : 0.12, 0.15 * vol);
        }
        break;
      }
      case 'skid':
        // One-shot tire scrape (the continuous drift layer is setSkid).
        burst(t, 0.25, 0.1 * vol, 'bandpass', 1400, 1.2);
        break;
      default:
        break;
    }
  } catch {
    /* audio must never break gameplay */
  }
}

// --- Continuous layers -----------------------------------------------------
// Each keeps a small persistent node graph while active and ramps its gain
// instead of hard-switching, so gating never clicks. All are idempotent.

let engine = null;   // { osc, sub, gain } — sawtooth + sub sine through a lowpass

/** Engine loop while driving: pitch tracks road speed, throttle loads it,
 *  nitro (boost) raises the pitch further. Gain stays modest under the SFX. */
export function setEngine(speedKmh, throttle = 0, boost = false) {
  if (!ensureCtx()) return;
  try {
    if (!engine) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      const subGain = ctx.createGain();
      subGain.gain.value = 0.5;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 850;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      sub.connect(subGain);
      subGain.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      osc.start();
      sub.start();
      engine = { osc, sub, gain };
    }
    const t = ctx.currentTime;
    const kmh = Math.max(0, speedKmh || 0);
    const rev = 42 + kmh * 1.35 + throttle * 26 + (boost ? 55 : 0);
    engine.osc.frequency.setTargetAtTime(rev, t, 0.08);
    engine.sub.frequency.setTargetAtTime(rev / 2, t, 0.08);
    const vol = 0.03 + Math.min(1, kmh / 160) * 0.025 + throttle * 0.02 + (boost ? 0.015 : 0);
    engine.gain.gain.setTargetAtTime(vol, t, 0.1);
  } catch {
    /* no-op */
  }
}

/** Fade the engine out and release its nodes (exit car, pause, wasted). */
export function stopEngine() {
  if (!engine) return;
  const e = engine;
  engine = null;
  try {
    const t = ctx.currentTime;
    e.gain.gain.setTargetAtTime(0, t, 0.05);
    e.osc.stop(t + 0.4);
    e.sub.stop(t + 0.4);
  } catch {
    /* nodes may already be gone */
  }
}

let skidNode = null;   // { src, gain } — looping filtered noise while drifting

/** Gate the drift scrape: band-passed tire noise, on while handbrake-drifting. */
export function setSkid(on) {
  if (!on && !skidNode) return;
  if (!ensureCtx()) return;
  try {
    if (on && !skidNode) {
      const src = ctx.createBufferSource();
      src.buffer = noise();
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1400;
      f.Q.value = 1.1;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(f);
      f.connect(gain);
      gain.connect(master);
      src.start();
      skidNode = { src, gain };
    }
    if (skidNode) skidNode.gain.gain.setTargetAtTime(on ? 0.07 : 0, ctx.currentTime, 0.06);
  } catch {
    /* no-op */
  }
}

/** Silence every continuous layer at once (pause, menu, wasted/busted).
 *  One-shots already in flight decay naturally within a few hundred ms. */
export function stopAll() {
  stopEngine();
  setSkid(false);
  setSiren(false);
}

let siren = null;      // { osc, lfo, gain } — two-tone sine, square-LFO swept
let sirenOn = false;

/** Gate the police two-tone: a sine centred at 825 Hz swept +/-125 Hz by a
 *  1.6 Hz square LFO, so it alternates 700/950 Hz. The caller toggles it from
 *  the light-bar flash phase; it only ever runs while a wanted level is up. */
export function setSiren(on) {
  const want = !!on;
  if (want === sirenOn) return;
  if (!want && !siren) return;
  if (!ensureCtx()) return;
  try {
    if (want && !siren) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 825;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1.6;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 125;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      lfo.start();
      siren = { osc, lfo, gain };
    }
    sirenOn = want;
    if (siren) siren.gain.gain.setTargetAtTime(want ? 0.05 : 0, ctx.currentTime, 0.03);
  } catch {
    /* no-op */
  }
}
