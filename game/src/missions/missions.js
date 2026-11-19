// LUMEN BAY mission engine: drives the 8-story missions from catalog.js.
// A mission is a list of stages; each frame the active stage is checked and
// completes when its condition is met, feeding onStage/onDialogue callbacks
// so main.js can pay out, spawn enemies, set wanted stars and save. Only one
// mission runs at a time; starting another cancels the current run cleanly.
import { MISSIONS, districtPoint, snapToRoad } from './catalog.js';

const DRIVE_RANGE = 8;   // metres: close enough to "arrive" at a target
const RACE_CHECK = 10;   // metres: checkpoint radius for a race stage

/** Resolve a stage's target to a concrete {x,z} point on the road grid. A
 *  district name maps through catalog.districtPoint (already snapped); a
 *  {x,z} object is snapped here. One snap at the end keeps it idempotent. */
function stageTarget(stage) {
  const pt = (typeof stage.target === 'string') ? districtPoint(stage.target) : (stage.target || null);
  return pt ? snapToRoad(pt.x, pt.z) : null;
}

/** Wanted-star control for a stage: set a floor when the stage asks for heat. */
function applyWantedFloor(hooks, stage) {
  if (stage.wanted != null && hooks.setWanted) hooks.setWanted(stage.wanted);
}

/** Plain XZ distance between two {x,z} points. */
function flatDist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Build the mission engine. `state` holds the mission list + currentMission;
 * `world` gives district centres for district-name targets.
 * @param {object} state shared game state
 * @param {object} world world query surface
 * @param {object} hooks callbacks: onStage, onDialogue, onComplete, onFail,
 *   spawnEnemies, setWanted, addMoney
 */
export function createMissions(state, world, hooks = {}) {
  const m = {
    id: null,           // mission id currently running, or null
    def: null,          // the catalog mission object
    stageIndex: 0,      // index into def.stages
    raceIndex: 0,       // checkpoint reached inside a race stage
    timer: 0,           // seconds left on a timed stage
    marker: null,       // current {x,z} target for the floating beacon
    spawned: [],        // enemies we created for the active shoot stage
    nextLine: null,     // the next briefing/story line to show
  };

  /** Unlock missions: all missions up to and including `id` become ACTIVE,
   *  later ones stay LOCKED father.
   */
  function unlockThrough(id) {
    if (!state.missions || state.missions.length === 0) state.missions = MISSIONS.map((x) => ({ id: x.id, status: 'LOCKED' }));
    let unlocked = false;
    for (const mi of state.missions) {
      if (mi.id === id) { mi.status = 'ACTIVE'; unlocked = true; }
      else if (unlocked) { /* only this one flips */ }
    }
    // Mark everything before the just-unlocked mission as DONE.
    let seen = false;
    for (const mi of state.missions) {
      if (mi.id === id) { seen = true; }
      else if (seen) mi.status = 'LOCKED';
      else mi.status = 'DONE';
    }
  }

  /** Start a mission by catalog id: reset the stage cursor, prime the
   *  dialogue and beacon, then run the first stage. */
  function start(id) {
    const def = MISSIONS.find((x) => x.id === id);
    if (!def) return false;
    m.id = id;
    m.def = def;
    m.stageIndex = 0;
    m.raceIndex = 0;
    m.timer = 0;
    m.spawned = [];
    m.nextLine = 0;
    state.currentMission = id;
    state.missionStage = `STAGE 1/${def.stages.length}`;
    if (state.missions) {
      const mi = state.missions.find((x) => x.id === id);
      if (mi) mi.status = 'ACTIVE';
    }
    runStage();
    return true;
  }

  /** Fail the running mission: clear state and hand the retry prompt back. */
  function fail(reason) {
    if (hooks.onFail) hooks.onFail(reason);
    clearMissionState();
  }

  /** Clear every runtime trace of the active mission. */
  function clearMissionState() {
    m.id = null;
    m.def = null;
    m.stageIndex = 0;
    m.raceIndex = 0;
    m.timer = 0;
    m.marker = null;
    m.spawned = [];
    state.currentMission = null;
    state.missionTarget = null;
    state.missionTimer = null;
    state.missionStage = null;
    state.missionNext = null;
    if (hooks.clearEnemies) hooks.clearEnemies();
  }

  /** Run the active stage: prime its timer, wanted floor, target beacon,
   *  spawned enemies and the HUD stage bar. */
  function runStage() {
    const def = m.def;
    const stage = def.stages[m.stageIndex];
    m.timer = stage.timerSec != null ? stage.timerSec : 0;
    m.raceIndex = 0;
    m.spawned = [];
    m.marker = stageTarget(stage);
    applyWantedFloor(hooks, stage);
    if (hooks.onStage) hooks.onStage(`STAGE ${m.stageIndex + 1}/${def.stages.length}: ${stage.text}`);
    state.missionStage = `STAGE ${m.stageIndex + 1}/${def.stages.length}`;
    state.missionTarget = m.marker ? { x: m.marker.x, z: m.marker.z } : null;
    state.missionTimer = m.timer > 0 ? m.timer : null;
    // Spawn any enemies the stage demands around its target point.
    if (stage.enemies && hooks.spawnEnemies) {
      const at = m.marker || { x: 0, z: 0 };
      m.spawned = hooks.spawnEnemies(stage.enemies.kind, at, stage.enemies.n) || [];
    }
    // Show the next dialogue line for this stage.
    if (def.dialogue && m.nextLine < def.dialogue.length && hooks.onDialogue) {
      const d = def.dialogue[m.nextLine];
      m.nextLine += 1;
      hooks.onDialogue(d.who, d.line, d.who);
    }
  }

  /** Advance to the next stage, or complete the mission at the last one. */
  function advanceStage() {
    m.stageIndex += 1;
    if (m.stageIndex >= m.def.stages.length) {
      completeMission();
      return;
    }
    runStage();
  }

  /** Mission finished: pay out, unlock the next chapter itch, save. */
  function completeMission() {
    const def = m.def;
    if (hooks.unlockNext) hooks.unlockNext(def);
    clearMissionState();
    if (hooks.onComplete) hooks.onComplete(def);
  }

  /** Poll one frame of the mission: a timed stage counts down; each stage
   *  type has its own completion rule. `playerPos` is {x,z} of the player. */
  function update(dt, playerPos) {
    if (!m.id || !m.def) return;
    const stage = m.def.stages[m.stageIndex];

    // Timed stages: tick the countdown; a timed, non-survive stage that runs
    // dry fails the mission. Survive stages hold the player instead and the
    // survivor branch below completes them when the clock reaches zero.
    if (m.timer > 0) {
      m.timer -= dt;
      state.missionTimer = Math.max(0, m.timer);
      if (m.timer <= 0 && stage.type !== 'survive') {
        fail('TIME');
        return;
      }
    }

    if (!playerPos) return;

    const type = stage.type;

    // --- go / deliver / drive: reach the target point (deliver is timed). ---
    if (type === 'go' || type === 'deliver' || type === 'drive') {
      if (m.marker && flatDist(playerPos, m.marker) <= DRIVE_RANGE) advanceStage();
      return;
    }

    // --- shoot: clear every enemy we spawned for this stage. ---
    if (type === 'shoot') {
      let remaining = 0;
      for (const e of m.spawned) if (e && e.alive) remaining += 1;
      // Fall back to polling the whole scene list if we have no own handle.
      if (m.spawned.length === 0 && hooks.enemyCount) remaining = hooks.enemyCount();
      if (remaining === 0) advanceStage();
      return;
    }

    // --- escape: wanted stars must hit zero. ---
    if (type === 'escape') {
      if (hooks.stars != null ? hooks.stars() <= 0 : state.stars <= 0) advanceStage();
      return;
    }

    // --- survive: the timer already ran out above and we did not fail. ---
    if (type === 'survive') {
      if (m.timer <= 0) advanceStage();
      return;
    }

    // --- race: reach checkpoints in order; the last one finishes the stage. ---
    if (type === 'race') {
      const stages = m.def.stages;
      const raceStages = stages.filter((s) => s.type === 'race');
      const at = stageTarget(raceStages[m.raceIndex] || stage);
      if (at && flatDist(playerPos, at) <= RACE_CHECK) {
        m.raceIndex += 1;
        if (m.raceIndex >= raceStages.length) advanceStage();
      }
      return;
    }
  }

  // --mission-stages-- marker: stage logic

  return { start, fail, clear: clearMissionState, unlockThrough, m, update };
}