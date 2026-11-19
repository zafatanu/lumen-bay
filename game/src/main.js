// LUMEN BAY — main bootstrap: fixed-step loop, screens, on-foot player,
// arcade driving, traffic + pedestrians, car stealing, clock advance, resize,
// and the ?shot= staging hook.
import * as THREE from 'three';
import { STEP, SEED, PLAYER } from './config.js';
import { createRandom, seedFromString } from './random.js';
import { createInput } from './input.js';
import { createState } from './state.js';
import { createCity } from './city/city.js';
import { createRenderer3D } from './render/scene.js';
import { CARS, buildCarMesh } from './vehicles/cars.js';
import { createDriver } from './vehicles/driving.js';
import { createTraffic } from './vehicles/traffic.js';
import { createOnFoot, followCamera } from './player/onfoot.js';
import { createArsenal } from './combat/weapons.js';
import { createEnemies } from './combat/enemies.js';
import { createCombat } from './combat/combat.js';
import { createWanted } from './police/wanted.js';
import { createPolice } from './police/units.js';

// --- Deterministic seed: the URL may override the fixed default. ---
const params = new URLSearchParams(window.location.search);
const seedParam = params.get('seed');
const rng = createRandom(seedParam ? seedFromString(seedParam) : SEED);

function boot() {
  const canvas = document.getElementById('world3d');
  const input = createInput();
  const state = createState();
  const renderer = createRenderer3D(canvas);
  const { scene, camera, update, resize } = renderer;

  // Build the island once; the whole city is deterministic from the seed.
  const city = createCity(scene, rng);
  const spawn = city.spawnPoints[0];

  // Traffic (cars + pedestrians) runs every frame.
  const traffic = createTraffic(scene, city, rng);

  // Driving physics + on-foot player share the scene and camera.
  const driver = createDriver(state, city, scene);
  const onFoot = createOnFoot(state, city, scene);
  const arsenal = createArsenal(state);
  const enemies = createEnemies(scene, city, rng);
  const crosshairEl = document.getElementById('crosshair');

  // Wanted system + the police units that hunt Rook. The controller keeps the
  // stars/heat on state; the units drive the road grid and heli at Rook.
  const wanted = createWanted(state);
  const police = createPolice(scene, city, rng, wanted);

  // Parked starter car: a Bay Runner on the Coral Beach boulevard beside spawn.
  const bayRunner = CARS.find((c) => c.name === 'Bay Runner') || CARS[1];
  let parked = null;
  {
    const mesh = buildCarMesh(bayRunner);
    const p = new THREE.Vector3(spawn.x, 0, spawn.z + 4);
    mesh.position.copy(p);
    scene.add(mesh);
    parked = { mesh, def: bayRunner, pos: p };
  }

  // Player begins on foot, just beside the parked car.
  onFoot.setPosition(new THREE.Vector3(spawn.x - 5, 0, spawn.z + 3), 0);

  // Combat wires in the on-foot player, the arsenal and the enemies.
  let downTimer = 0; // seconds to linger on the WASTED screen before respawn
  const combat = createCombat(scene, state, arsenal, enemies, onFoot, {
    traffic,
    crosshair: crosshairEl,
    wanted,
    onDown: onWasted,
    onHurt: (dmg) => { state.pushPopup(`HIT −${Math.round(dmg)}`); },
  });

  // Wasted screen: Rook drops, then respawns at the hospital for $500.
  function onWasted() {
    state.wastedCount += 1;
    downTimer = 1.8;
    const wasted = document.getElementById('wasted-screen');
    if (wasted) wasted.style.display = 'grid';
  }
  // Busted screen: a cop grabs Rook while wanted; the fine is steeper and the
  // mission (if one is running) fails.
  function onBusted() {
    state.bustedCount += 1;
    downTimer = 2.0;
    const fine = Math.min(800, state.money);
    state.money = Math.max(0, state.money - fine);
    state.pushPopup(`BUSTED −$${fine}`);
    if (state.missionId !== null) {
      state.missionId = null;
      state.pushPopup('MISSION FAILED');
    }
    const busted = document.getElementById('busted-screen');
    if (busted) busted.style.display = 'grid';
  }
  function respawn() {
    state.down = false;
    state.health = PLAYER.health;
    state.armour = PLAYER.armour;
    state.money = Math.max(0, state.money);
    state.stars = 0;
    state.heat = 0;
    state.inCar = false;
    const wasted = document.getElementById('wasted-screen');
    if (wasted) wasted.style.display = 'none';
    const busted = document.getElementById('busted-screen');
    if (busted) busted.style.display = 'none';
    // Teleport back to the Coral Beach boulevard, away from the trouble.
    onFoot.setPosition(new THREE.Vector3(spawn.x - 5, 0, spawn.z + 6), 0);
    onFoot.show();
  }

  // --- Screens: title shows until the player starts; Esc pauses; M maps. ---
  let screen = 'title';
  function show(next) { screen = next; }

  // --- Fixed-step 1/60 loop with an accumulated remainder. ---
  let accumulator = 0;
  let last = performance.now();

  function handleScreens() {
    if (input.pressed('Enter') || input.pressed('Space')) {
      if (screen === 'title') show('play');
      else if (screen === 'paused') show('play');
    }
    if (input.pressed('Escape')) {
      show(screen === 'play' ? 'paused' : 'play');
    }
    if (input.pressed('KeyM')) {
      show(screen === 'map' ? 'play' : 'map');
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const frameTime = Math.min((now - last) / 1000, 0.1);
    last = now;
    accumulator += frameTime;
    handleScreens();
    input.clear();
    while (accumulator >= STEP) {
      step(STEP);
      accumulator -= STEP;
    }
    // Scene render + HUD refresh happen once per display frame.
    update(STEP, state.clockMinutes);
    const hudClock = document.getElementById('clock');
    if (hudClock) hudClock.textContent = state.formatClock();
    // Drain popups so they disappear after their lifetime.
    if (state.popups.length) {
      state.popups = state.popups.filter((p) => { p.t -= STEP; return p.t > 0; });
    }
  }

  /** Enter/steal the car the on-foot player is closest to within reach. */
  function trySteal() {
    const pp = onFoot.getPosition();
    const reach = PLAYER.reach + 0.8;
    if (parked && pp.distanceTo(parked.pos) < reach) {
      state.carsStolen += 1;
      driver.enterCar(parked.def, parked.pos);
      scene.remove(parked.mesh);
      parked = null;
      onFoot.hide();
      state.inCar = true;
      state.pushPopup('BAY RUNNER');
      return;
    }
    for (const tc of traffic.cars) {
      if (!tc.visible) continue;
      if (pp.distanceTo(tc.pos) < reach) {
        state.carsStolen += 1;
        if (tc.driver) {
          wanted.addHeat(22, 'steal');
          state.pushPopup('CAR STOLEN');
        }
        tc.visible = false;
        scene.remove(tc.mesh);
        driver.enterCar(tc.def, tc.pos);
        onFoot.hide();
        state.inCar = true;
        return;
      }
    }
  }

  /** Get out of the car and back on foot. */
  function exitCar() {
    const drop = driver.exitCar();
    if (!drop) return;
    onFoot.setPosition(drop, driver.heading);
    onFoot.show();
    state.inCar = false;
    state.currentCar = null;
    state.speedKmh = 0;
    // Snap the chase FOV back to the on-foot baseline so the view isn't wide.
    camera.fov = 60;
    camera.updateProjectionMatrix();
  }

  function step(dt) {
    state.advanceClock(dt);

    // Ferris wheel spins slowly whenever it exists.
    if (city.wheel && city.wheel.userData.spin) {
      city.wheel.userData.spin.rotation.z += dt * 0.08;
    }

    const snap = input.snapshot();
    onFoot.setWeapon(arsenal.current.id);

    if (state.down) {
      // WASTED: linger on the screen, then respawn at the hospital.
      downTimer -= dt;
      if (downTimer <= 0) respawn();
    } else if (state.inCar) {
      driver.update(dt, snap);
      driver.updateCamera(camera, dt);
      const tm = traffic.update(dt, driver.car.position, driver.speedKmh());
      if (tm && tm.nearMiss) state.noteNearMiss();
      if (input.consumeAny(['KeyF'])) exitCar();
    } else {
      followCamera(camera, dt, onFoot.getPosition(), onFoot.heading);
      onFoot.update(dt, snap, camera, combat.aimYaw, combat.aiming);
      traffic.update(dt, onFoot.getPosition(), 0);
      if (input.consumeAny(['KeyF'])) trySteal();
    }

    // Combat runs every step: ammo/reload, flashes, enemy AI and any hits.
    combat.update(dt, input, camera);

    // Police: units drive at Rook, ram his car and — on foot, up close — bust
    // him. Rook's position and speed feed the chase; the result can shove the
    // player's car or end the run.
    if (!state.down) {
      const ppos = state.inCar ? driver.car.position : onFoot.getPosition();
      const pspd = state.inCar ? driver.speedKmh() : 0;
      const res = police.update(dt, ppos, null, wanted.stars, state.inCar, pspd);
      if (res.bust) onBusted();
      if (res.ram && state.inCar && driver.car) {
        driver.car.position.x += res.ram.x * dt * 30;
        driver.car.position.z += res.ram.z * dt * 30;
      }
    }
  }

  // Expose a mission hook: spawn a named enemy kind at a world point. Extra
  // options (health, aggressive) pass straight through to the enemy spawner.
  function spawnEnemyForMission(kind, pos, opts = {}) {
    return enemies.spawnEnemy(kind, pos, opts);
  }

  // --- Resize. ---
  window.addEventListener('resize', resize);
  resize();

  // --- ?shot= staging hook: let the chase cam settle, render once, then signal.
  if (params.has('shot')) {
    for (let i = 0; i < 10; i += 1) step(STEP);
    update(STEP, state.clockMinutes);
    requestAnimationFrame(() => { window.__shotReady = true; });
  }

  requestAnimationFrame(frame);
  return { spawnEnemyForMission, state, arsenal, combat, enemies };
}

boot();