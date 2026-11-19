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
import { createMissions } from './missions/missions.js';
import { createSideJobs } from './missions/sidejobs.js';
import { districtPoint, MISSIONS as missionCatalog } from './missions/catalog.js';
import { drawPortrait } from './missions/characters.js';
import { createHud } from './hud/hud.js';
import { createRadio } from './audio/radio.js';
import { createMenu, loadSettings, saveSettings } from './meta/menu.js';
import { createMap } from './meta/map.js';
import { createPause } from './meta/pause.js';
import { stageShot, SHOT_SCENES } from './shots.js';

// --- Deterministic seed: the URL may override the fixed default. ---
const params = new URLSearchParams(window.location.search);
const seedParam = params.get('seed');
const rng = createRandom(seedParam ? seedFromString(seedParam) : SEED);

function boot() {
  const canvas = document.getElementById('world3d');
  const input = createInput();
  const state = createState();
  // Captured once when a ?shot= scene is staged, then replayed each frame so
  // the autopilot keeps driving/firing until the screenshot lands.
  let shotSnap = null;
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

  // Dense HUD + WebAudio synth radio. `getPlayer` gives the HUD a single
  // live source of the player's world position/heading whether driving or
  // on foot; the radio object stays optional so the HUD falls back to the
  // radioStation/radioTrack fields on state (kept current by the N key).
  const hudEl = document.getElementById('hud');
  const radio = createRadio();
  const hud = createHud(state, hudEl, {
    getPlayer: () => {
      if (state.inCar && driver.car) {
        return { x: driver.car.position.x, z: driver.car.position.z, heading: driver.heading, inCar: true };
      }
      const p = onFoot.getPosition();
      return { x: p.x, z: p.z, heading: onFoot.heading, inCar: false };
    },
    arsenal,
    radio,
    police,
  });

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

  // Wasted screen: Rook drops, then respawns at the hospital for $500. A
  // running mission fails when Rook goes down.
  function onWasted() {
    state.wastedCount += 1;
    downTimer = 1.8;
    if (state.currentMission) mission.fail('WASTED');
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
    if (state.currentMission) mission.fail('BUSTED');
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

  // --- Mission + side-job engine. ---
  // A floating beacon (light pillar + diamond) marks the current objective.
  const beacon = new THREE.Group();
  {
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.16, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd19a, transparent: true, opacity: 0.5 })
    );
    pillar.position.y = 8;
    beacon.add(pillar);
    const diamond = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 1.2, 4),
      new THREE.MeshBasicMaterial({ color: 0x2ae0c0, transparent: true, opacity: 0.9 })
    );
    diamond.rotation.y = Math.PI / 4;
    diamond.position.y = 17;
    beacon.add(diamond);
    beacon.visible = false;
    scene.add(beacon);
  }

  // Mission-start markers in the world: Mama Luz in the Old Quarter plus the
  // three side-job givers. Each is a small flat sign the player walks into
  // and presses E to start the work.
  const missionMarkers = [];
  function addMarker(pos, label, kind, jobId) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2ae0c0, emissive: 0x0f6a5e });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 0.2), mat);
    sign.position.set(pos.x, 1.1, pos.z);
    scene.add(sign);
    missionMarkers.push({ pos, label, kind, jobId, mesh: sign, ring: null });
  }
  addMarker(districtPoint('Old Quarter'), 'MAMA LUZ', 'mission', null);
  addMarker(districtPoint('Downtown'), 'TAXI', 'sidejob', 'taxi');
  addMarker(districtPoint('Coral Beach'), 'TACO', 'sidejob', 'taco');
  addMarker(districtPoint('Marina'), 'RACE', 'sidejob', 'race');

  const mission = createMissions(state, city, {
    onStage: (text) => { state.missionNext = text; },
    onDialogue: (who, line) => {
      state.dialogue = { who, line, portrait: drawPortrait(who) };
    },
    onComplete: (def) => {
      state.money += def.reward.money;
      state.addRepXp(def.reward.repXp);
      if (!state.completedMissions.includes(def.id)) state.completedMissions.push(def.id);
      state.pushPopup(`MISSION CLEAR +$${def.reward.money} +${def.reward.repXp} XP`);
      state.save();
    },
    onFail: (reason) => {
      state.dialogue = {
        who: 'Mama Luz',
        line: reason === 'TIME' ? 'You took too long, Rook. Restart when you\u2019re ready.' : 'Not tonight. Try again at the marker.',
        portrait: drawPortrait('Mama Luz'),
      };
    },
    unlockNext: (def) => {
      // Unlock the story mission that follows the one just completed.
      const nextId = nextMissionId(def.id);
      if (nextId) mission.unlockThrough(nextId);
    },
    spawnEnemies: (kind, pos, n) => {
      const list = [];
      for (let i = 0; i < n; i += 1) {
        const off = new THREE.Vector3(pos.x + (i - n / 2) * 3, 0, pos.z + (i % 2) * 3);
        const e = spawnEnemyForMission(kind, off, {});
        if (e) list.push(e);
      }
      return list;
    },
    setWanted: (n) => wanted.setStars(n),
    clearEnemies: () => enemies.clear(),
    stars: () => state.stars,
    addMoney: (n) => { state.money += n; },
  });

  // Unlock the first story mission; the rest follow as chapters complete.
  mission.unlockThrough('m1');

  const sideJobs = createSideJobs(state, city, {
    addMoney: (n) => { state.money += n; },
    onPopup: (t) => state.pushPopup(t),
  });

  // Scatter the 24 conch shells across the island.
  const shells = sideJobs.placeShells(scene);

  // The mission that follows `id` in the catalog order, or null at the last.
  function nextMissionId(id) {
    const i = missionCatalog.findIndex((m) => m.id === id);
    if (i < 0 || i >= missionCatalog.length - 1) return null;
    return missionCatalog[i + 1].id;
  }

  // --- Screens: menu -> play; Esc pauses; M maps. The world stays visible
  // behind every overlay, with a slow camera orbit on the title menu. ---
  let screen = 'menu';
  let radioStarted = false;
  let driftBank = 0;
  let menuAngle = 0.6;
  const titleEl = document.getElementById('title-screen');

  /** Start the synth radio on the first real user gesture; browsers block the
   *  AudioContext until a key/mouse event, so this must sit in the input path. */
  function ensureRadio() {
    if (radioStarted) return;
    radioStarted = true;
    radio.start();
    const cur = radio.current();
    state.radioStation = `${cur.station} \u00b7 ${cur.freq} MHz`;
    state.radioTrack = cur.track;
  }

  /** Apply the persisted settings object to the live systems: radio volume /
   *  mute, minimap visibility and screen-shake flag. Called at boot and after
   *  the SETTINGS panel changes anything. */
  function applySettings() {
    const s = state.settings || {};
    const volume = Number.isFinite(s.volume) ? Math.max(0, Math.min(1, s.volume)) : 1;
    if (radio) radio.setMuted(!s.music || volume <= 0);
    const mm = document.querySelector('#hud [data-hud="minimap"]');
    if (mm) mm.style.display = s.minimap === false ? 'none' : '';
    state.shakeEnabled = s.shake !== false;
  }

  /** Choose the next mission id after `id` in the catalog, or null at the end. */
  function nextMissionId(id) {
    const i = missionCatalog.findIndex((m) => m.id === id);
    if (i < 0 || i >= missionCatalog.length - 1) return null;
    return missionCatalog[i + 1].id;
  }

  /** Start a brand-new run: reset state, unlock the first mission and open it. */
  function newGame() {
    state.reset();
    // Keep the player's persisted settings across a fresh run.
    state.settings = Object.assign({ volume: 1, music: true, minimap: true, shake: true }, loadSettings());
    applySettings();
    mission.unlockThrough('m1');
    state.pushPopup('Ch.1 \u00b7 First Light');
    onFoot.setPosition(new THREE.Vector3(spawn.x - 5, 0, spawn.z + 3), 0);
    onFoot.show();
    state.inCar = false;
    if (state.currentCar) { state.currentCar = null; state.speedKmh = 0; }
  }

  /** Load the saved run back (player position, money, missions, car) and
   *  restore any active mission so the objective recap is accurate. */
  function continueGame() {
    if (state.load()) {
      applySettings();
      onFoot.setPosition(new THREE.Vector3(state.lastSeenPos && state.lastSeenPos.x != null ? state.lastSeenPos.x : spawn.x - 5, 0, state.lastSeenPos && state.lastSeenPos.z != null ? state.lastSeenPos.z : spawn.z + 3), 0);
      onFoot.show();
    } else {
      newGame();
    }
  }

  // --- Menu / map / pause overlay controllers. ---
  let menuClose = createMenu(state, {
    onContinue: () => { ensureRadio(); continueGame(); setScreen('play'); },
    onNewGame: () => { ensureRadio(); newGame(); setScreen('play'); },
    onControls: () => showSub('CONTROLS', controlsText()),
    onSettings: () => openSettings(),
    onHowTo: () => showSub('HOW TO PLAY', howToText()),
  });
  const map = createMap(state, () => {
    const p = state.inCar && driver.car ? driver.car.position : onFoot.getPosition();
    return { x: p.x, z: p.z };
  }, police);
  const pause = createPause(state, {
    onResume: () => setScreen('play'),
    onRestart: () => { if (state.currentMission) mission.start(state.currentMission); setScreen('play'); },
    onSettings: () => openSettings(),
    onQuit: () => { state.save(); setScreen('menu'); },
  });

  // A lightweight transient panel for SETTINGS / CONTROLS / HOW TO PLAY.
  const subEl = document.createElement('div');
  subEl.className = 'sub-panel';
  subEl.style.display = 'none';
  document.body.appendChild(subEl);
  function showSub(title, html) {
    subEl.innerHTML = `<div class="sub-title">${title}</div>${html}<button class="sub-close" data-sub="close">BACK</button>`;
    subEl.style.display = 'block';
    subEl.querySelector('[data-sub="close"]').addEventListener('click', () => { subEl.style.display = 'none'; });
  }
  function hideSub() { subEl.style.display = 'none'; }

  /** Settings panel: volume slider + music/minimap/shake toggles. Changes are
   *  applied live and persisted under lumen-bay-settings. */
  function openSettings() {
    const s = state.settings;
    showSub('SETTINGS', `
      <div class="set-row"><span>VOLUME</span>
        <input type="range" min="0" max="100" value="${Math.round((s.volume || 1) * 100)}" data-set="volume"></div>
      <div class="set-row"><span>MUSIC</span><input type="checkbox" data-set="music" ${s.music ? 'checked' : ''}></div>
      <div class="set-row"><span>MINIMAP</span><input type="checkbox" data-set="minimap" ${s.minimap !== false ? 'checked' : ''}></div>
      <div class="set-row"><span>SCREEN SHAKE</span><input type="checkbox" data-set="shake" ${s.shake !== false ? 'checked' : ''}></div>
    `);
    subEl.querySelector('[data-set="volume"]').addEventListener('input', (e) => {
      s.volume = Number(e.target.value) / 100;
      saveSettings(state.settings);
      applySettings();
    });
    subEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        s[cb.dataset.set] = cb.checked;
        saveSettings(state.settings);
        applySettings();
      });
    });
  }

  /** Controls reference text (same bindings as the HUD footer). */
  function controlsText() {
    return `<div class="sub-body">WASD drive/walk \u00b7 SPACE handbrake \u00b7 F enter/steal car \u00b7 E interact
      <br>CLICK shoot \u00b7 1-4 weapons \u00b7 R reload \u00b7 N radio \u00b7 M map \u00b7 ESC pause</div>`;
  }

  /** How-to-play panel: goal, controls, wanted, tips. */
  function howToText() {
    return `<div class="sub-body">
      <b>Goal</b> \u2014 play 8 story missions across Lumen Bay, build REP, and own the island.
      <br><b>Driving</b> \u2014 steal a car with F, drive with WASD, handbrake with SPACE.
      <br><b>Wanted</b> \u2014 cops chase at 1-5 stars; lose them to clear your heat.
      <br><b>Tips</b> \u2014 drift for cash, grab conch shells (+$100), and finish missions to autosave.
    </div>`;
  }

  /** Apply the boot settings before the first frame, and hide the title. */
  // Persisted settings (lumen-bay-settings) win over the state defaults so a
  // fresh boot keeps the player's last choices until a save overrides them.
  state.settings = Object.assign(state.settings, loadSettings());
  applySettings();
  titleEl.style.display = 'none';
  setScreen('menu');

  /** Central screen switch: updates `screen` and shows/hides overlays. */
  function setScreen(next) {
    screen = next;
    hideSub();
    if (next !== 'menu') { menuClose && menuClose(); menuClose = null; }
    if (next === 'menu') { menuClose && menuClose(); titleEl.style.display = 'none'; menuRefresh(); }
    else if (next === 'play') { menuClose && menuClose(); menuClose = null; map.close(); pause.close(); titleEl.style.display = 'none'; }
    else if (next === 'paused') { pause.open(); map.close(); }
    else if (next === 'map') { map.open(); pause.close(); }
  }

  /** Rebuild the menu DOM each time we return to it, so CONTINUE reflects the
   *  current save and NEW GAME always asks to overwrite. */
  function menuRefresh() {
    menuClose && menuClose();
    menuClose = createMenu(state, menuCallbacks());
  }
  function menuCallbacks() {
    return {
      onContinue: () => { ensureRadio(); continueGame(); setScreen('play'); },
      onNewGame: () => { ensureRadio(); newGame(); setScreen('play'); },
      onControls: () => showSub('CONTROLS', controlsText()),
      onSettings: () => openSettings(),
      onHowTo: () => showSub('HOW TO PLAY', howToText()),
    };
  }

  // --- Fixed-step 1/60 loop with an accumulated remainder. ---
  let accumulator = 0;
  let last = performance.now();

  function handleScreens() {
    // The title menu has its own DOM buttons and keyboard nav; don't double
    // handle Enter/Space here.
    if (screen === 'menu') { consumeNav(); return; }
    if (input.pressed('Enter') || input.pressed('Space')) {
      ensureRadio();
      if (screen === 'title') setScreen('menu');
      else if (screen === 'paused') setScreen('play');
    }
    if (input.pressed('Escape')) {
      ensureRadio();
      if (screen === 'play') setScreen('paused');
      else if (screen === 'paused' || screen === 'map') setScreen('play');
    }
    if (input.pressed('KeyM')) {
      ensureRadio();
      if (screen === 'play') setScreen('map');
      else if (screen === 'map') setScreen('play');
    }
    // N cycles the radio station; any other key press is also a user gesture
    // that can resume a suspended AudioContext, so start audio here too.
    if (input.consumeAny(['KeyN'])) {
      ensureRadio();
      const cur = radio.next();
      if (cur) {
        state.radioStation = `${cur.station} \u00b7 ${cur.freq} MHz`;
        state.radioTrack = cur.track;
        state.pushPopup(`RADIO \u2014 ${cur.station}`);
      }
    }
  }

  /** Swallow stray nav presses while the menu owns the screen so they don't
   *  leak into the first frame of play. */
  function consumeNav() {
    input.consumeAny(['Enter', 'Space', 'Escape', 'KeyM', 'KeyN']);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const frameTime = Math.min((now - last) / 1000, 0.1);
    last = now;
    accumulator += frameTime;
    handleScreens();
    // Only step the simulation while actually playing; the menu/map/pause
    // screens freeze the world (rendered statically each frame behind them).
    if (screen === 'play') {
      while (accumulator >= STEP) {
        step(STEP, shotSnap || undefined);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    input.clear();
    // Scene render + HUD refresh happen once per display frame.
    if (screen === 'menu') menuCamera(frameTime);
    update(STEP, state.clockMinutes);
    hud.update(STEP);
    // Drain popups so they disappear after their lifetime.
    if (state.popups.length) {
      state.popups = state.popups.filter((p) => { p.t -= STEP; return p.t > 0; });
    }
  }

  /** Slow orbit around the spawn while the title menu is open. */
  function menuCamera(dt) {
    menuAngle += dt * 0.12;
    const r = 66;
    const h = 24;
    camera.position.set(spawn.x + Math.cos(menuAngle) * r, h, spawn.z + Math.sin(menuAngle) * r);
    camera.lookAt(spawn.x, 0, spawn.z);
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

  function step(dt, snapOverride) {
    state.advanceClock(dt);

    // Ferris wheel spins slowly whenever it exists.
    if (city.wheel && city.wheel.userData.spin) {
      city.wheel.userData.spin.rotation.z += dt * 0.08;
    }

    // The screenshot autopilot (shots.js) may pass a scripted snapshot so the
    // world plays forward without real keyboard/mouse events; a plain load
    // reads the live input controller as usual.
    const snap = snapOverride || input.snapshot();
    onFoot.setWeapon(arsenal.current.id);

    if (state.down) {
      // WASTED: linger on the screen, then respawn at the hospital.
      downTimer -= dt;
      if (downTimer <= 0) respawn();
    } else if (state.inCar) {
      driver.update(dt, snap);
      driver.updateCamera(camera, dt);
      const tm = traffic.update(dt, driver.car.position, driver.speedKmh());
      if (tm && tm.nearMiss) {
        state.noteNearMiss();
        state.money += 250;
        state.pushPopup('NEAR MISS +$250');
      }
      // Bank drift points while the driver is sliding; cash them out the moment
      // the slide ends (driftScore decays to ~0), so a reward pops per drift.
      if (driver.drifting()) {
        driftBank += driver.driftScore * 0.6;
      } else if (driftBank > 60) {
        const x3 = Math.max(1, Math.round(driftBank / 100));
        const cash = x3 * 50;
        state.pushPopup(`DRIFT x${x3} +$${cash}`);
        state.driftScore += cash;
        state.money += cash;
        driftBank = 0;
      } else {
        driftBank = 0;
      }
      if (input.consumeAny(['KeyF'])) exitCar();
    } else {
      followCamera(camera, dt, onFoot.getPosition(), onFoot.heading);
      onFoot.update(dt, snap, camera, combat.aimYaw, combat.aiming);
      traffic.update(dt, onFoot.getPosition(), 0);
      if (input.consumeAny(['KeyF'])) trySteal();
    }

    // Combat runs every step: ammo/reload, flashes, enemy AI and any hits.
    // The screenshot autopilot's snapshot flows through so Rook can fire.
    combat.update(dt, input, camera, snapOverride);

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

    // --- Missions + side jobs + collectibles. ---
    const ppos = state.inCar ? driver.car.position : onFoot.getPosition();
    if (!state.down) {
      mission.update(dt, ppos);
      sideJobs.update(dt, ppos, shells, scene);
      updateBeacon();
      if (input.consumeAny(['KeyE'])) tryStartMission();
    }
  }

  // Expose a mission hook: spawn a named enemy kind at a world point. Extra
  // options (health, aggressive) pass straight through to the enemy spawner.
  function spawnEnemyForMission(kind, pos, opts = {}) {
    return enemies.spawnEnemy(kind, pos, opts);
  }

  // Keep the floating objective beacon on the current mission target.
  function updateBeacon() {
    const t = state.missionTarget || state.sideJobTarget;
    if (!t) { beacon.visible = false; return; }
    beacon.position.set(t.x, 0, t.z);
    beacon.visible = true;
  }

  // Pressing E beside a mission/side-job marker starts that job, if its
  // story mission is unlocked (story) or its district is ready (side job).
  function tryStartMission() {
    const pp = onFoot.getPosition();
    const reach = PLAYER.reach + 2.5;
    let nearest = null;
    for (const mk of missionMarkers) {
      const d = Math.hypot(mk.pos.x - pp.x, mk.pos.z - pp.z);
      if (d <= reach && (!nearest || d < nearest.d)) nearest = { mk, d };
    }
    if (!nearest) return;
    const mk = nearest.mk;
    if (mk.kind === 'mission') {
      if (state.currentMission) { state.pushPopup('Already on a job.'); return; }
      // Only the currently-unlocked story mission is startable at the marker.
      const active = (state.missions || []).find((mi) => mi.status === 'ACTIVE');
      if (active) mission.start(active.id);
    } else if (mk.kind === 'sidejob') {
      if (state.currentMission) { state.pushPopup('Finish the story mission first.'); return; }
      if (state.sideJob) { state.pushPopup('Already running a side job.'); return; }
      sideJobs.start(mk.jobId);
    }
  }

  // --- Resize. ---
  window.addEventListener('resize', resize);
  resize();

  // --- ?shot= staging hook: stage a real, autopiloted scene (shots.js) into
  // the live world, then let the render loop paint it for a few frames before
  // signalling the screenshot harness via window.__shotReady. ---
  if (params.has('shot')) {
    const shotName = params.get('shot');
    const shotCtx = {
      state, city, driver, onFoot, arsenal, enemies, wanted, police, combat,
      mission, sideJobs, input, scene, camera, spawn, traffic, hud,
      crosshair: crosshairEl, parked, CARS, MISSIONS: missionCatalog,
      setScreen, ensureRadio, applySettings,
      stepWorld: step, update,
    };
    shotSnap = stageShot(SHOT_SCENES.includes(shotName) ? shotName : '3-menu', shotCtx);
    let stagedFrames = 0;
    const flagReady = () => {
      stagedFrames += 1;
      if (stagedFrames < 3) requestAnimationFrame(flagReady);
      else window.__shotReady = true;
    };
    requestAnimationFrame(flagReady);
    requestAnimationFrame(frame);
    return;
  }

  requestAnimationFrame(frame);
  return { spawnEnemyForMission, state, arsenal, combat, enemies };
}

boot();