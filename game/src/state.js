// Central game state for LUMEN BAY: bank, rank, day/clock, health, armour,
// wanted stars, mission progress, collectibles and persistent save.
import { MONEY_START, REP_START, REP_NAME, DAY, SAVE_KEY, POLICE } from './config.js';

export function createState() {
  const fresh = () => ({
    money: MONEY_START,
    rep: REP_START,
    repName: REP_NAME,
    xp: 0,
    day: 1,
    clockMinutes: DAY.startMinutes,
    health: 100,
    armour: 0,
    stars: 0,
    heat: 0,
    bustedCount: 0,
    lastSeenPos: null,
    policeFeed: [],
    missionId: null,
    missionStage: 0,
    completedMissions: [],
    // S5: mission engine + dialogue + collectibles live state. `missions` is
    // the map-screen list; `dialogue` feeds the HUD; target/timer/stage/next
    // are read each frame by the beacon + HUD.
    missions: [],
    currentMission: null,
    dialogue: null,
    missionTarget: null,
    missionTimer: null,
    missionNext: null,
    sideJob: null,
    sideJobTarget: null,
    sideJobTimer: null,
    shells: 0,
    repXp: 0,
    sideJobs: [],
    collectibles: 0,
    carsStolen: 0,
    escapes: 0,
    takedowns: 0,
    wastedCount: 0,
    down: false,
    playSeconds: 0,
    inCar: false,
    currentCar: null,
    driftScore: 0,
    nearMissCount: 0,
    speedKmh: 0,
    popups: [],
    // S6: the HUD radio widget reads these; main.js refreshes them from the
    // WebAudio synth radio whenever the station or track changes.
    radioStation: 'WAVE 88.1',
    radioTrack: 'Midnight Circuit',
  });

  const state = fresh();

  function save() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      Object.assign(state, fresh(), JSON.parse(raw));
      // Coerce saved fields back to numbers: an old or hand-edited save must
      // not poison the sim with string arithmetic.
      const numeric = ['money', 'rep', 'xp', 'day', 'clockMinutes', 'health', 'armour', 'stars',
        'heat', 'bustedCount', 'carsStolen', 'escapes', 'takedowns', 'wastedCount', 'collectibles',
        'playSeconds', 'driftScore', 'nearMissCount', 'speedKmh', 'shells', 'repXp'];
      for (const k of numeric) {
        const v = Number(state[k]);
        if (Number.isFinite(v)) state[k] = v;
        else state[k] = 0;
      }
      if (typeof state.inCar !== 'boolean') state.inCar = false;
      if (typeof state.down !== 'boolean') state.down = false;
      return true;
    } catch {
      return false;
    }
  }

  function reset() {
    Object.assign(state, fresh());
  }

  function advanceClock(realSeconds) {
    // Freeze the clock once the last day ends so the finale can't be skipped past.
    if (state.day >= DAY.days && state.clockMinutes >= DAY.minutesPerDay) return;
    state.playSeconds += realSeconds;
    state.clockMinutes += realSeconds * DAY.clockSpeed;
    while (state.clockMinutes >= DAY.minutesPerDay) {
      state.clockMinutes -= DAY.minutesPerDay;
      state.day += 1;
    }
    if (state.day > DAY.days) state.day = DAY.days;
  }

  function addXp(amount) {
    state.xp += amount;
    let stars = 0;
    for (let t = 0; t < POLICE.stars.length; t += 1) {
      if (state.xp >= POLICE.stars[t]) stars += 1;
      else break;
    }
    state.stars = stars;
  }

  function formatClock() {
    const mins = Math.floor(state.clockMinutes) % DAY.minutesPerDay;
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  /** A one-line status readback for HUD text and the mission panel later. */
  function summary() {
    return `${state.day}/${DAY.days} ${formatClock()} · $${state.money} · ${state.repName} · ${state.stars}★`;
  }

  /** Queue a short-lived on-screen popup; the HUD drains them over time. */
  function pushPopup(text) {
    state.popups.push({ text, t: 3.0 });
  }

  /** Raise wanted stars directly (e.g. stealing a car); clamps to the cap. */
  function addStars(n) {
    state.stars = Math.max(0, Math.min(POLICE.stars.length, state.stars + n));
  }

  /** Record a traffic near-miss for the HUD stat; call from the driver's frame. */
  function noteNearMiss() {
    state.nearMissCount += 1;
  }

  /** True while the current car is driveable; the HUD reads this to warn the player. */
  function carCondition() {
    return state.currentCar ? state.currentCar.condition : 0;
  }

  /** Rank progress: missions and collectibles pay rep XP toward the next rank. */
  function addRepXp(amount) {
    state.repXp = (state.repXp || 0) + amount;
  }

  return { state, save, load, reset, advanceClock, addXp, formatClock, summary, pushPopup, addStars, noteNearMiss, carCondition, addRepXp };
}