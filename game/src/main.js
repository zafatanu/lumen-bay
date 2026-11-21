// GENERATIONAL AUTO — main bootstrap: fixed-step loop, screens, on-foot player,
// arcade driving, traffic + pedestrians, car stealing, clock advance, resize,
// and the ?shot= staging hook.
import * as THREE from 'three';
import { STEP, SEED, PLAYER, SAVE_KEY } from './config.js';
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
import * as sfx from './audio/sfx.js';
import { createMenu, loadSettings, saveSettings } from './meta/menu.js';
import { createMap } from './meta/map.js';
import { createPause } from './meta/pause.js';
import { stageShot, SHOT_SCENES, STAGE_ALIASES } from './shots.js';

// --- Deterministic seed: the URL may override the fixed default. ---
const params = new URLSearchParams(window.location.search);
const seedParam = params.get('seed');
const rng = createRandom(seedParam ? seedFromString(seedParam) : SEED);

function boot() {
  const canvas = document.getElementById('world3d');
  const input = createInput(canvas);
  const state = createState();
  // The wanted controller records the last-seen position as a plain {x,z}
  // object, then updates it with .set() on the next sighting. Wrap the field
  // so any assigned record carries a .set — no wanted-logic change, and the
  // method is non-enumerable so saves still serialise as exactly {x,z}.
  {
    const wrap = (v) => {
      if (v && typeof v.set !== 'function') {
        Object.defineProperty(v, 'set', {
          value(x, y, z) { this.x = x; this.z = z; return this; },
          enumerable: false, writable: true, configurable: true,
        });
      }
      return v;
    };
    let lsp = wrap(state.lastSeenPos);
    Object.defineProperty(state, 'lastSeenPos', {
      get() { return lsp; },
      set(v) { lsp = wrap(v); },
      enumerable: true, configurable: true,
    });
  }
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
    // Live job-giver markers for the minimap blips (defined below; the
    // getter is only called once the frame loop runs).
    getMarkers: () => missionMarkers,
    // Live conch-shell handles from placeShells() ({mesh,pos,taken}); the
    // minimap/map plot the real catalog spots and drop the taken ones.
    // Same late-binding pattern as getMarkers — shells is defined below.
    getShells: () => shells,
    // Flesh-hit flash from combat.js (created below, after this HUD): only
    // called from hud.update(), never at construction.
    getHitMarker: () => ({ t: combat.hitMarker, kill: combat.hitKill }),
    // Pointer-lock state for the "click to lock mouse" hint.
    getLocked: () => input.locked(),
  });

  // Parked starter car: a Bay Runner beside spawn, just within steal reach
  // (2.83 m from Rook's spawn) so a fresh player can press F at spawn and drive.
  const bayRunner = CARS.find((c) => c.name === 'Bay Runner') || CARS[1];
  let parked = null;
  {
    const mesh = buildCarMesh(bayRunner);
    const p = new THREE.Vector3(spawn.x + 2, 0, spawn.z + 8);
    mesh.position.copy(p);
    scene.add(mesh);
    parked = { mesh, def: bayRunner, pos: p };
  }

  // Player begins on foot, just beside the parked car.
  onFoot.setPosition(new THREE.Vector3(spawn.x, 0, spawn.z + 6), 0);

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
    sfx.stopAll();   // the sim freezes while Rook is down: no engine/siren drone
    if (state.currentMission) mission.fail('WASTED');
    const wasted = document.getElementById('wasted-screen');
    if (wasted) wasted.style.display = 'grid';
  }
  // Busted screen: a cop grabs Rook while wanted; the fine is steeper and the
  // mission (if one is running) fails.
  function onBusted() {
    state.bustedCount += 1;
    downTimer = 2.0;
    sfx.stopAll();   // sim freezes while busted: no engine/siren drone
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
      new THREE.CylinderGeometry(0.14, 0.34, 46, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc24a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })
    );
    pillar.position.y = 15;
    beacon.add(pillar);
    const diamond = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 2.8, 4),
      new THREE.MeshBasicMaterial({ color: 0x2ae0c0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })
    );
    diamond.rotation.y = Math.PI / 4;
    diamond.position.y = 37;
    beacon.add(diamond);
    beacon.visible = false;
    scene.add(beacon);
  }

  // Mission-start markers in the world: Mama Luz in the Old Quarter plus the
  // three side-job givers. Each one reads from the street as a pulsing ground
  // ring, a tall pillar of light and a bobbing name label above the sign, so
  // a fresh player can always see where to press E. Story = warm gold;
  // side jobs keep the teal the old signs used. The minimap and full map
  // draw matching blips (hud.js / meta/map.js) from this same list.
  const missionMarkers = [];
  const MARKER_COLOURS = {
    mission: { hex: 0xffc24a, css: '#ffc24a', emissive: 0x8a5a12, ringR: 2.0, pillarH: 26 },
    sidejob: { hex: 0x2ae0c0, css: '#2ae0c0', emissive: 0x0f6a5e, ringR: 1.5, pillarH: 18 },
  };
  /** Canvas name-plate for a marker label, in the marker's own colour on a
   *  dark backing so it stays legible against the sunset sky. */
  function markerLabelTexture(text, css) {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(10,14,22,0.88)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = css;
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 56);
    ctx.fillStyle = css;
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function addMarker(pos, label, kind, jobId) {
    const c = MARKER_COLOURS[kind] || MARKER_COLOURS.sidejob;
    const mat = new THREE.MeshStandardMaterial({ color: c.hex, emissive: c.emissive, emissiveIntensity: 0.6 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 0.2), mat);
    sign.position.set(pos.x, 1.1, pos.z);
    scene.add(sign);
    // Pulsing ground ring: flat additive torus the player can't miss.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(c.ringR, 0.08, 8, 48),
      new THREE.MeshBasicMaterial({ color: c.hex, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.06, pos.z);
    scene.add(ring);
    // Tall thin beacon pillar of light straight above the sign.
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.28, c.pillarH, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: c.hex, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    pillar.position.set(pos.x, c.pillarH / 2, pos.z);
    scene.add(pillar);
    // Bobbing name label: a camera-facing sprite with the canvas name-plate.
    const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerLabelTexture(label, c.css), transparent: true, depthWrite: false }));
    const labelY = 2.9;
    labelSprite.scale.set(3.0, 0.75, 1);
    labelSprite.position.set(pos.x, labelY, pos.z);
    scene.add(labelSprite);
    missionMarkers.push({
      pos, label, kind, jobId, mesh: sign, ring, pillar, labelSprite, labelY,
      phase: missionMarkers.length * 1.7,
    });
  }
  /** Per-frame marker life: ring scale/opacity pulse, pillar shimmer and a
   *  gentle label bob. Deterministic phases, no randomness. */
  let markerTime = 0;
  function updateMarkers(dt) {
    markerTime += dt;
    for (const mk of missionMarkers) {
      const w = 0.5 + 0.5 * Math.sin(markerTime * 2.6 + mk.phase);
      const s = 1 + 0.16 * Math.sin(markerTime * 2.6 + mk.phase);
      mk.ring.scale.set(s, s, 1);
      mk.ring.material.opacity = 0.5 + 0.35 * w;
      mk.pillar.material.opacity = 0.24 + 0.12 * (0.5 + 0.5 * Math.sin(markerTime * 1.9 + mk.phase));
      mk.labelSprite.position.y = mk.labelY + 0.16 * Math.sin(markerTime * 1.7 + mk.phase);
    }
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
      sfx.play('missionClear');
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
    // Pass the 0..1 volume through (0 when music is off) so the slider
    // scales the radio instead of hard-muting it.
    if (radio) radio.setMuted(!s.music ? 0 : volume);
    const mm = document.querySelector('#hud [data-hud="minimap"]');
    if (mm) mm.style.display = s.minimap === false ? 'none' : '';
    state.shakeEnabled = s.shake !== false;
  }

  // --- Mouse-look orbit (R3-8). Rook and the car steer with the keyboard; the
  // camera is the mouse now. The orbit heading and hill pitch are eased here
  // each display frame from the travel input.js piled up, so a flick swings the
  // view instead of teleporting it.
  const LOOK_PITCH_MIN = -0.8;
  const LOOK_PITCH_MAX = 1.2;
  // Radians of orbit per unit of pointer travel (input.js reports mousemove
  // pixels): ~0.0045 swings ~0.26 rad per 60 px, a natural view for a flick.
  const LOOK_RATE = 0.0045;
  let lookSens = 1;
  let lookInvert = 1;
  let lookYaw = 0;
  let lookYawLast = 0;
  let lookPitch = 0;
  // The look button is held with a gun up and the pointer locked: the crosshair
  // is up, and onFoot keeps Rook's shoulders on the view while he stands.
  let looking = false;

  function readLookSettings() {
    const s = state.settings || {};
    lookSens = Number.isFinite(s.lookSens) ? Math.max(0.4, Math.min(2.6, s.lookSens)) : 1;
    lookInvert = s.invertY ? -1 : 1;
  }

  function aimOpts(snapOverride, over) {
    if (snapOverride) return null;
    readLookSettings();
    return { lookYaw, lookPitch, over: !!over, locked: input.locked() };
  }

  /** Choose the next mission id after `id` in the catalog, or null at the end. */
  function nextMissionId(id) {
    const i = missionCatalog.findIndex((m) => m.id === id);
    if (i < 0 || i >= missionCatalog.length - 1) return null;
    return missionCatalog[i + 1].id;
  }

  /** Snap the follow camera directly behind Rook (same back=9.0 / up=2.5 /
   *  chest look as followCamera), so a new or continued run never lerps in
   *  from wherever the menu orbit left the camera. */
  function snapFollowCamera() {
    const p = onFoot.getPosition();
    const h = onFoot.heading;
    camera.position.set(p.x - Math.sin(h) * 9.0, p.y + 2.5, p.z - Math.cos(h) * 9.0);
    camera.userData.followLook = new THREE.Vector3(p.x, p.y + 1.0, p.z);
    camera.lookAt(p.x, p.y + 1.0, p.z);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    // A snap (new run / respawn) also starts the mouse-look orbit behind Rook.
    lookYaw = h;
    lookPitch = 0;
  }

  /** Put the camera on the mouse-look orbit round Rook: `back` metres behind
   *  the view heading, up with the pitch. Its look point stays on Rook's chest
   *  so a turn swings the whole shot. */
  function placeLookCamera(cam, pos, back) {
    const cp = Math.cos(lookPitch);
    const sp = Math.sin(lookPitch);
    cam.position.set(pos.x - Math.sin(lookYaw) * back * cp, pos.y + 2.5 + back * sp, pos.z - Math.cos(lookYaw) * back * cp);
    if (!cam.userData.followLook) cam.userData.followLook = new THREE.Vector3(pos.x, pos.y + 1.0, pos.z);
    cam.userData.followLook.set(pos.x, pos.y + 1.0, pos.z);
    cam.lookAt(pos.x, pos.y + 1.0, pos.z);
    cam.fov = 55;
    cam.updateProjectionMatrix();
  }

  /** True when a persisted save exists; gates the first-run onboarding so it
   *  only ever plays on a genuinely fresh NEW GAME, never on CONTINUE or an
   *  overwrite of an existing save. */
  function hasSave() {
    try { return !!window.localStorage.getItem(SAVE_KEY); } catch { return false; }
  }

  // First-run toasts reuse the existing popup system (3s lifetime each) and
  // are staggered past that lifetime so they never stack on one frame. The
  // token invalidates pending toasts if another new run starts mid-sequence.
  let onboardingToken = 0;
  function startOnboarding() {
    const token = onboardingToken;
    const say = (text, delayMs) => {
      window.setTimeout(() => {
        if (token === onboardingToken) state.pushPopup(text);
      }, delayMs);
    };
    say('Follow the gold beacon \u2014 that\u2019s your first job.', 3200);
    say('Press E at the beacon to start the job.', 6400);
    say('WASD to move \u00b7 F to steal a car \u00b7 Space for nitro.', 9600);
  }

  /** Start a brand-new run: reset state, unlock the first mission and open it. */
  function newGame() {
    const fresh = !hasSave();
    onboardingToken += 1;   // cancel any pending onboarding toast
    state.reset();
    // Keep the player's persisted settings across a fresh run.
    state.settings = Object.assign({ volume: 1, music: true, minimap: true, shake: true }, loadSettings());
    applySettings();
    mission.unlockThrough('m1');
    if (fresh) {
      // Objective line now, then the staggered 3-step how-to sequence.
      state.pushPopup('Ch.1 \u00b7 First Light \u2014 your first job waits at the gold beacon.');
      startOnboarding();
    } else {
      state.pushPopup('Ch.1 \u00b7 First Light');
    }
    // Face Rook along the spawn→first-target vector (-120,-84) so the gold
    // beacon is in frame at spawn: the camera looks along (sin h, cos h), so
    // h = atan2(target.x - spawn.x, target.z - spawn.z).
    const targetH = Math.atan2(-120 - spawn.x, -84 - spawn.z);
    onFoot.setPosition(new THREE.Vector3(spawn.x, 0, spawn.z + 6), targetH);
    onFoot.show();
    snapFollowCamera();
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
      snapFollowCamera();
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
  }, police, () => missionMarkers, () => shells);
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

  /** Settings panel: volume and mouse-sensitivity sliders + music / minimap
   *  / shake / invert-Y toggles. Changes are applied live and persisted under
   *  lumen-bay-settings. */
  function openSettings() {
    const s = state.settings;
    showSub('SETTINGS', `
      <div class="set-row"><span>VOLUME</span>
        <input type="range" min="0" max="100" value="${Math.round((s.volume || 1) * 100)}" data-set="volume"></div>
      <div class="set-row"><span>MUSIC</span><input type="checkbox" data-set="music" ${s.music ? 'checked' : ''}></div>
      <div class="set-row"><span>MINIMAP</span><input type="checkbox" data-set="minimap" ${s.minimap !== false ? 'checked' : ''}></div>
      <div class="set-row"><span>SCREEN SHAKE</span><input type="checkbox" data-set="shake" ${s.shake !== false ? 'checked' : ''}></div>
      <div class="set-row"><span>MOUSE SENSITIVITY</span>
        <input type="range" min="40" max="260" value="${Math.round((s.lookSens || 1) * 100)}" data-set="lookSens"></div>
      <div class="set-row"><span>INVERT Y</span><input type="checkbox" data-set="invertY" ${s.invertY ? 'checked' : ''}></div>
    `);
    subEl.querySelector('[data-set="volume"]').addEventListener('input', (e) => {
      s.volume = Number(e.target.value) / 100;
      saveSettings(state.settings);
      applySettings();
    });
    // Mouse-look is read live by readLookSettings() every frame; persist here.
    subEl.querySelector('[data-set="lookSens"]').addEventListener('input', (e) => {
      s.lookSens = Number(e.target.value) / 100;
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
    return `<div class="sub-body">WASD drive/walk \u00b7 E interact \u00b7 F enter/steal car \u00b7 SPACE nitro \u00b7 H handbrake \u00b7 Q horn
      <br>CLICK shoot \u00b7 1-4 weapons \u00b7 R reload \u00b7 N radio \u00b7 M map \u00b7 ESC pause</div>`;
  }

  /** How-to-play panel: goal, first job, controls, wanted, tips. */
  function howToText() {
    return `<div class="sub-body">
      <b>Goal</b> \u2014 play 8 story missions across Lumen Bay, build REP, and own the island.
      <br><b>First job</b> \u2014 follow the gold beacon to Mama Luz and press E at the marker to start.
      <br><b>Driving</b> \u2014 steal a car with F, drive with WASD, SPACE for nitro, H for handbrake.
      <br><b>Wanted</b> \u2014 cops chase at 1-5 stars; lose them to clear your heat.
      <br><b>Tips</b> \u2014 drift for cash, grab conch shells (+$100), and finish missions to autosave.
    </div>`;
  }

  /** Apply the boot settings before the first frame. */
  // Persisted settings (lumen-bay-settings) win over the state defaults so a
  // fresh boot keeps the player's last choices until a save overrides them.
  state.settings = Object.assign(state.settings, loadSettings());
  applySettings();
  setScreen('menu');

  /** Central screen switch: updates `screen` and shows/hides overlays. */
  function setScreen(next) {
    screen = next;
    hideSub();
    // Ghosting fix: the menu/map/pause overlays are semi-transparent, so the
    // live HUD underneath bleeds through them. Hide every HUD panel (plus the
    // crosshair and popups) via one class whenever we are not in play; the
    // overlays themselves are .fullscreen siblings, so they stay visible.
    // hud.update() keeps running untouched — removing the class on return to
    // play brings the whole HUD back on the very next frame.
    hudEl.classList.toggle('hud-hidden', next !== 'play');
    // Leaving play freezes the sim: silence the continuous audio layers so
    // the engine/siren never drone under the menu, map or pause overlay.
    if (next !== 'play') sfx.stopAll();
    if (next !== 'menu') { menuClose && menuClose(); menuClose = null; }
    if (next === 'menu') { menuClose && menuClose(); menuRefresh(); }
    else if (next === 'play') { menuClose && menuClose(); menuClose = null; map.close(); pause.close(); }
    else if (next === 'paused') { pause.open(); map.close(); }
    else if (next === 'map') { map.open(); pause.close(); }
    // The mouse belongs to the overlay that just took the screen: release the
    // look lock there, and hide the OS cursor again over the view in play.
    if (next !== 'play' && input.locked()) document.exitPointerLock();
    setCursorMode(next === 'play' ? (input.locked() ? 'cross' : 'hidden') : 'default');
  }

  /** Rebuild the menu DOM each time we return to it, so CONTINUE reflects the
   *  current save and NEW GAME always asks to overwrite. */
  function menuRefresh() {
    menuClose && menuClose();
    menuClose = createMenu(state, menuCallbacks());
  }
  /** Press the view to take the mouse. The press that takes the lock is spent
   *  by input.js (eaten before it queues a shot), so it never fires a round. */
  /** Swap the OS cursor style for the active screen: hidden over the view in
   *  play with no lock (the crosshair is the pointer), a crosshair under the
   *  lock, and the normal arrow wherever an overlay owns the mouse. */
  function setCursorMode(mode) {
    canvas.style.cursor = mode === 'hidden' ? 'none' : mode === 'cross' ? 'crosshair' : 'default';
  }

  function onLockChange() {
    const locked = input.locked();
    setCursorMode(screen === 'play' ? (locked ? 'cross' : 'hidden') : 'default');
  }

  document.addEventListener('pointerlockchange', onLockChange);

  /** Take the lock on a canvas PRESS (left button only) and never on a click:
   *  a locked canvas is fullscreened by ESC, so a locked press cannot be the
   *  pointer-locked click the browser would use to drop it — it is a shot. This
   *  handler and input.js's window press listener both exist before any lock;
   *  an unlocked press's window listener runs before this one, and input.js
   *  queues its edge only if the pointer was already locked (see onPointerDown). */
  function onCanvasPointerDown(event) {
    if (screen !== 'play' || input.locked()) return;
    if (event.button !== undefined && event.button !== 0) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* pointer lock declining is a non-event */ }
  }
  canvas.addEventListener('pointerdown', onCanvasPointerDown);

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
      if (screen === 'paused') setScreen('play');
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

  /** Mouse-look, once per display frame. Quiet off the play screen (every
   *  overlay owns the cursor), then drains the travel input.js piled up since
   *  the last frame into the orbit: sensitivity scales both axes, invert-Y
   *  flips only the pitch, and the pitch is clamped so the view never rolls
   *  over. The drain happens BEFORE the fixed steps, so combat.aimHeading()
   *  reading the orbit is current, never a frame stale. */
  function updateLook() {
    if (screen !== 'play') { input.look(); return; }
    const d = input.look();
    if (!d.x && !d.y) return;
    if (!d.x && !d.y) return;
    readLookSettings();
    lookYaw -= d.x * LOOK_RATE * lookSens;
    lookPitch = Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX,
      lookPitch - d.y * LOOK_RATE * lookSens * lookInvert));
    // The model idles with its shoulders facing the view and only breaks the
    // turn when Rook actually moves, so he never pivots in place on the spot.
    onFoot.onLook?.(lookYaw, looking);
  }

  /** Frame-rate independent orbit ease for the fixed steps: sec -> 0..1. */
  function lookEase(sec) {
    return 1 - Math.exp(-sec * 10);
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
      if (shotSnap) {
        // Staged capture (?shot=): hold the staged pose for the screenshot
        // harness. The kit stages a scene and paints it without running the
        // loop; stepping on would drift the camera (follow + FOV ease),
        // fade the downed Gull, expire the muzzle flash and drift the stars
        // before the screenshot lands.
        accumulator = 0;
      } else {
        while (accumulator >= STEP) {
          step(STEP, shotSnap || undefined);
          accumulator -= STEP;
        }
      }
    } else {
      accumulator = 0;
    }
    input.clear();
    // Mouse-look runs on the display clock, before the render and HUD read it.
    updateLook(frameTime);
    // Scene render + HUD refresh happen once per display frame.
    if (screen === 'menu') menuCamera(frameTime);
    update(STEP, state.clockMinutes);
    hud.update(STEP);
    // Drain popups so they disappear after their lifetime. A staged capture
    // (?shot=) holds them like it holds the sim: stepping the drain would
    // expire the cover's DRIFT payout before the screenshot lands.
    if (!shotSnap && state.popups.length) {
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
    camera.fov = 55;
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
    // reads the live input controller as usual. The broadstep note above is
    // kept next to the combat hand-off, which always steps this same dt.
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
      // On foot the follow camera takes the mouse-look orbit heading; the
      // over-shoulder lean waits for the right button with a gun up. A plain
      // unlocked mouse keeps the look where it is (input.js only turns it on
      // a locked pointer), so a click that fires never whips the view.
      const over = !!snap.mouseAim && combat.aiming;
      looking = over && input.locked();
      followCamera(camera, dt, onFoot.getPosition(), lookYaw, city.colliders,
        { pitch: lookPitch, over, reset: !input.locked() });
      onFoot.onLook?.(lookYaw, lookYawLast);
      onFoot.update(dt, snap, camera, combat.aimYaw, combat.aiming);
      traffic.update(dt, onFoot.getPosition(), 0);
      if (input.consumeAny(['KeyF'])) trySteal();
    }

    // Combat runs every step: ammo/reload, flashes, enemy AI and any hits.
    // The screenshot autopilot's snapshot flows through so Rook can fire; the
    // live session also passes the mouse-look orbit as the aim (R3-8), which a
    // staged capture omits so the scripted shots aim camera-forward as ever.
    combat.update(dt, input, camera, snapOverride,
      snapOverride ? null : { lookYaw, lookPitch, over: !!snap.mouseAim, locked: input.locked() });

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
      updateMarkers(dt);
      if (input.consumeAny(['KeyE'])) tryStartMission();
    }
  }

  // Expose a mission hook: spawn a named enemy kind at a world point. Extra
  // options (health, aggressive) pass straight through to the enemy spawner.
  function spawnEnemyForMission(kind, pos, opts = {}) {
    return enemies.spawnEnemy(kind, pos, opts);
  }

  // Keep the floating objective beacon on the current mission target. In free
  // roam (no active job) it homes on the first unlocked story mission's first
  // stage target, so a fresh spawn always has the gold beacon ahead — close
  // and dead-in-frame, exactly the direction newGame faces Rook toward.
  function updateBeacon() {
    const t = state.missionTarget || state.sideJobTarget;
    if (t) { beacon.position.set(t.x, 0, t.z); beacon.visible = true; return; }
    const active = (state.missions || []).find((mi) => mi.status === 'ACTIVE');
    const def = active && missionCatalog.find((m) => m.id === active.id);
    const stage = def && def.stages && def.stages[0];
    const ft = stage && stage.target;
    if (!ft) { beacon.visible = false; return; }
    const pos = typeof ft === 'object' ? ft : (missionMarkers.find((m) => m.label === ft) || {}).pos;
    if (!pos) { beacon.visible = false; return; }
    beacon.position.set(pos.x, 0, pos.z);
    beacon.visible = true;
  }

  // Pressing E beside a mission/side-job marker starts that job, if its
  // story mission is unlocked (story) or its district is ready (side job).
  // Every path that can't start a job says why via a popup — no silent
  // no-ops. Mission state logic itself is unchanged.
  function tryStartMission() {
    if (state.inCar) { state.pushPopup('Get out to start the job (F).'); return; }
    const pp = onFoot.getPosition();
    const reach = PLAYER.reach + 2.5;
    let nearest = null;
    for (const mk of missionMarkers) {
      const d = Math.hypot(mk.pos.x - pp.x, mk.pos.z - pp.z);
      if (d <= reach && (!nearest || d < nearest.d)) nearest = { mk, d };
    }
    if (!nearest) { state.pushPopup('No job available here yet \u2014 find a glowing marker.'); return; }
    const mk = nearest.mk;
    if (mk.kind === 'mission') {
      if (state.currentMission) { state.pushPopup('Finish the current job first.'); return; }
      // Only the currently-unlocked story mission is startable at the marker.
      const active = (state.missions || []).find((mi) => mi.status === 'ACTIVE');
      if (!active) { state.pushPopup('No story job unlocked yet.'); return; }
      if (!mission.start(active.id)) state.pushPopup('That job is not ready yet.');
    } else if (mk.kind === 'sidejob') {
      if (state.currentMission) { state.pushPopup('Finish the story mission first.'); return; }
      if (state.sideJob) { state.pushPopup('Already running a side job.'); return; }
      if (!sideJobs.start(mk.jobId)) state.pushPopup('That job is not ready yet.');
    }
  }

  // --- Resize. ---
  window.addEventListener('resize', resize);
  resize();

  // --- ?shot= staging hook: stage a real, autopiloted scene (shots.js) into
  // the live world, then hold it frozen (frame() skips stepping while shotSnap
  // is set) and let the render loop paint it for a few frames before signalling
  // the screenshot harness via window.__shotReady. ?stage=chase|
  // shootout|menu|map aliases onto the same scenes (?shot= wins if both set);
  // with neither parameter the game boots normally. ---
  const stageParam = params.get('stage');
  const stageName = stageParam && Object.prototype.hasOwnProperty.call(STAGE_ALIASES, stageParam)
    ? STAGE_ALIASES[stageParam] : null;
  if (params.has('shot') || stageName) {
    const shotName = params.has('shot') ? params.get('shot') : stageName;
    const shotCtx = {
      state, city, driver, onFoot, arsenal, enemies, wanted, police, combat,
      mission, sideJobs, input, scene, camera, spawn, traffic, hud,
      crosshair: crosshairEl, parked, CARS, MISSIONS: missionCatalog,
      // Live conch handles for staging-only consistency tweaks (stageMap).
      shells,
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