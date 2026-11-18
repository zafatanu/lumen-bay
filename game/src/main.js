// LUMEN BAY — main bootstrap: fixed-step loop, screens, chase camera,
// ferris wheel spin, clock advance, resize, and the ?shot= staging hook.
import * as THREE from 'three';
import { STEP, SEED, CAMERA } from './config.js';
import { createRandom, seedFromString } from './random.js';
import { createInput } from './input.js';
import { createState } from './state.js';
import { createCity } from './city/city.js';
import { createRenderer3D } from './render/scene.js';

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

  // --- Screens: title shows until the player starts; Esc pauses; M maps. ---
  let screen = 'title';
  function show(next) {
    screen = next;
  }

  // --- Chase camera: an orbit view around the spawn that glides in. ---
  const camPivot = new THREE.Vector3(spawn.x, 0, spawn.z);
  let camGlide = 0;
  let camAngle = 0.6;

  // --- Fixed-step 1/60 loop with an accumulated remainder. ---
  let accumulator = 0;
  let last = performance.now();

  // One-shot key presses drive the screen flow.
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

    // Scene render + HUD clock refresh happen once per display frame.
    update(STEP, state.clockMinutes);
    const hudClock = document.getElementById('clock');
    if (hudClock) hudClock.textContent = state.formatClock();
  }

  function step(dt) {
    // Clock always advances, even over the title — the day rolls on.
    state.advanceClock(dt);

    // Ferris wheel spins slowly whenever it exists.
    if (city.wheel && city.wheel.userData.spin) {
      city.wheel.userData.spin.rotation.z += dt * 0.08;
    }

    // Chase camera: glide in then drift in a slow lazy orbit.
    camGlide = Math.min(1, camGlide + dt * CAMERA.glide);
    camAngle += dt * CAMERA.orbitSpeed;
    const dist = CAMERA.distStart + camGlide * CAMERA.distMax;
    camera.position.set(
      camPivot.x + Math.cos(camAngle) * dist,
      CAMERA.heightStart + camGlide * CAMERA.heightMax,
      camPivot.z + Math.sin(camAngle) * dist
    );
    camera.lookAt(camPivot.x, CAMERA.lookHeight, camPivot.z);
  }

  // --- Resize. ---
  window.addEventListener('resize', resize);
  resize();

  // --- ?shot= staging hook: render the city from the chase viewpoint once,
  //     then signal the harness that a frame is ready to capture. ---
  if (params.has('shot')) {
    // Advance the camera to its resting pose and draw a single frame.
    for (let i = 0; i < 10; i += 1) step(STEP);
    update(STEP, state.clockMinutes);
    requestAnimationFrame(() => { window.__shotReady = true; });
  }

  requestAnimationFrame(frame);
}

boot();