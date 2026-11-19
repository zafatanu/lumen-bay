// LUMEN BAY side jobs + collectibles: taxi fares, taco runs, a street race
// and 24 collectible conch shells. Each side job reuses the mission-stage
// pattern (pickup markers, countdown, payout on completion, fail on timeout).
// Conch shells sit at fixed city spots; walk within 3m to pick one up.
import * as THREE from 'three';
import { SHELLS, SIDE_JOBS, SHELL_TOTAL, districtPoint } from './catalog.js';

const PICKUP_RANGE = 8;   // metres: reach a stop/target
const SHELL_RANGE = 3;    // metres: reach a conch shell
const SHELL_AMOUNT = 100; // $ paid per shell

/** Resolve a stop target to a concrete {x,z}: a district name maps through
 *  catalog.districtPoint; a {x,z} object passes through untouched. */
function stopPoint(stop) {
  if (typeof stop.target === 'string') return districtPoint(stop.target);
  return stop.target || null;
}

/** Plain XZ distance between two {x,z} points. */
function flatDist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Build the side-job + collectible controllers.
 * @param {object} state shared game state (reads/writes state.sideJob,
 *   state.shells, state.money, state.popups)
 * @param {object} world world query surface
 * @param {object} hooks optional callbacks: onPayout, onPopup, addMoney,
 *   spawnEnemies, setWanted
 */
export function createSideJobs(state, world, hooks = {}) {
  const job = {
    id: null,        // active side job id, or null
    def: null,       // the SIDE_JOBS entry
    stopIndex: 0,    // next stop to reach
    timer: 0,        // seconds left on the current stop
    marker: null,    // current {x,z} target
  };

  /** A tiny flat-orange conch shell mesh to scatter across the island. */
  function buildShell() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffb37a, roughness: 0.6 });
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.06, 6, 12), mat);
    coil.rotation.x = Math.PI / 2;
    group.add(coil);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.12), mat);
    lip.position.z = 0.18;
    group.add(lip);
    return group;
  }

  // --sidejob-stop-- marker: start/run/complete helpers

  /** Begin a side job from its catalog entry id. */
  function startJob(id) {
    const def = SIDE_JOBS.find((x) => x.id === id);
    if (!def) return false;
    job.id = id;
    job.def = def;
    job.stopIndex = 0;
    job.timer = 0;
    job.marker = stopPoint(def.stops[0]);
    state.sideJob = { id, stopIndex: 0, title: def.title };
    runStop();
    return true;
  }

  /** Prime the current stop: marker, timer and a brief popup. */
  function runStop() {
    const stop = job.def.stops[job.stopIndex];
    job.marker = stopPoint(stop);
    job.timer = stop.timerSec != null ? stop.timerSec : 0;
    state.sideJob = { id: job.id, stopIndex: job.stopIndex, title: job.def.title };
    state.sideJobTarget = job.marker ? { x: job.marker.x, z: job.marker.z } : null;
    state.sideJobTimer = job.timer > 0 ? job.timer : null;
    if (hooks.onPopup) hooks.onPopup(job.def.title);
    else if (state.pushPopup) state.pushPopup(job.def.title);
  }

  /** Advance a stop or pay out at the final one. */
  function advanceJob() {
    job.stopIndex += 1;
    if (job.stopIndex >= job.def.stops.length) {
      payJob();
      return;
    }
    runStop();
  }

  /** Side job finished: pay the bonus and clear the runtime state. */
  function payJob() {
    const payout = job.def.payout || 0;
    if (hooks.addMoney) hooks.addMoney(payout);
    else if (state) { state.money += payout; }
    if (hooks.onPayout) hooks.onPayout(payout);
    else if (state.pushPopup) state.pushPopup(`JOB PAID +$${payout}`);
    state.sideJob = null;
    state.sideJobTarget = null;
    state.sideJobTimer = null;
    job.id = null;
    job.def = null;
    job.stopIndex = 0;
  }

  /** Fail a side job on timeout: clear it and notify the player. */
  function failJob(reason) {
    if (state.pushPopup) state.pushPopup(reason === 'TIME' ? 'JOB FAILED — TOO SLOW' : 'JOB FAILED');
    state.sideJob = null;
    state.sideJobTarget = null;
    state.sideJobTimer = null;
    job.id = null;
    job.def = null;
    job.stopIndex = 0;
  }

  // --sidejob-shell-- marker: shell building + update

  /** Place a conch mesh in the scene at each catalog shell spot; returns the
   *  array of live shell handles (mesh + pos + taken flag). */
  function placeShells(scene) {
    const out = [];
    for (const s of SHELLS) {
      const mesh = buildShell();
      mesh.position.set(s.x, 0.4, s.z);
      mesh.rotation.y = (s.x + s.z) * 0.01;
      if (scene) scene.add(mesh);
      out.push({ mesh, pos: s, taken: false });
    }
    return out;
  }

  /** Drive one frame of the active side job + pick up nearby conch shells.
   *  `playerPos` is {x,z}; `shells` is the array placeShells() returned. */
  function update(dt, playerPos, shells, scene) {
    // Conch shells: pick up any within reach, once, for cash + a popup.
    if (shells && playerPos) {
      for (const sh of shells) {
        if (sh.taken) continue;
        if (flatDist(playerPos, sh.pos) <= SHELL_RANGE) {
          sh.taken = true;
          if (scene) scene.remove(sh.mesh);
          state.shells = (state.shells || 0) + 1;
          if (hooks.addMoney) hooks.addMoney(SHELL_AMOUNT);
          else state.money += SHELL_AMOUNT;
          if (hooks.onPopup) hooks.onPopup(`CONCH +$${SHELL_AMOUNT} (${state.shells}/${SHELL_TOTAL})`);
          else if (state.pushPopup) state.pushPopup(`CONCH +$${SHELL_AMOUNT} (${state.shells}/${SHELL_TOTAL})`);
        }
      }
    }

    if (!job.id || !job.def) return;

    // Timed stop: count down and fail on an empty meter.
    if (job.timer > 0) {
      job.timer -= dt;
      state.sideJobTimer = Math.max(0, job.timer);
      if (job.timer <= 0) {
        failJob('TIME');
        return;
      }
    }

    if (!playerPos || !job.marker) return;
    if (flatDist(playerPos, job.marker) <= PICKUP_RANGE) advanceJob();
  }

  return { start: startJob, update, placeShells, job };
}