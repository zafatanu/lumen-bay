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
    missionId: null,
    missionStage: 0,
    completedMissions: [],
    sideJobs: [],
    collectibles: 0,
    carsStolen: 0,
    escapes: 0,
    takedowns: 0,
    playSeconds: 0,
    inCar: false,
    currentCar: null,
    driftScore: 0,
    nearMissCount: 0,
    speedKmh: 0,
    popups: [],
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
        'carsStolen', 'escapes', 'takedowns', 'playSeconds', 'driftScore', 'nearMissCount', 'speedKmh'];
      for (const k of numeric) {
        const v = Number(state[k]);
        if (Number.isFinite(v)) state[k] = v;
        else state[k] = 0;
      }
      if (typeof state.inCar !== 'boolean') state.inCar = false;
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

  return { state, save, load, reset, advanceClock, addXp, formatClock, summary, pushPopup, addStars, noteNearMiss, carCondition };
}