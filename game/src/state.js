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

  return { state, save, load, reset, advanceClock, addXp, formatClock, summary };
}