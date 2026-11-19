// Deterministic screenshot scenes behind ?shot=1-chase|2-shootout|3-menu|4-map.
// Each stages the REAL game forward from a fresh world, steered by a scripted
// autopilot, so the frame is what a real play session looks like and the same
// seed always gives the same frame. `ctx` bundles the live boot() systems:
// state, driver, onFoot, arsenal, enemies, wanted, police, mission, sideJobs,
// input, scene, camera, traffic, hud, plus setScreen/ensureRadio/stepWorld.
import { STEP } from './config.js';

export const SHOT_SCENES = ['1-chase', '2-shootout', '3-menu', '4-map'];

/** Reset the shared state and set the missions list with `doneThrough` chapters
 *  DONE (0 = none) and the following chapter ACTIVE, so the menu CONTINUE and
 *  the map panel both read a believable, mid-story save. */
function freshState(ctx, { doneThrough = 0, money = 2400, day = 1, rep = 1, repXp = 0 } = {}) {
  ctx.state.reset();
  ctx.state.money = money;
  ctx.state.day = day;
  ctx.state.rep = rep;
  ctx.state.repXp = repXp;
  ctx.state.missions = (ctx.MISSIONS || []).map((m) => {
    const n = parseInt(String(m.id).replace(/\D/g, ''), 10);
    if (doneThrough > 0 && n <= doneThrough) return { id: m.id, status: 'DONE' };
    if (doneThrough + 1 === n) return { id: m.id, status: 'ACTIVE' };
    return { id: m.id, status: 'LOCKED' };
  });
}

/** A driving snapshot: full throttle straight ahead on the boulevard. */
function driveSnap() {
  return { up: true, down: false, left: false, right: false, sprint: false,
    handbrake: false, interact: false, jump: false, honk: false, recover: false,
    weapon: 1, mouseX: 400, mouseY: 240, mouseDown: false };
}

/** An on-foot snapshot: standing (or walking) with the SMG held, trigger down
 *  when `fire` is true so a muzzle flash is caught mid-frame. */
function shootSnap(fire) {
  return { up: false, down: false, left: false, right: false, sprint: false,
    handbrake: false, interact: false, jump: false, honk: false, recover: false,
    weapon: 3, mouseX: 400, mouseY: 240, mouseDown: fire };
}

// --shots-helpers-- marker: helpers append below

export function stageShot(name, ctx) {
  switch (name) {
    case '1-chase': return stageChase(ctx);
    case '2-shootout': return stageShootout(ctx);
    case '4-map': return stageMap(ctx);
    case '3-menu':
    default: return stageMenu(ctx);
  }
}

// --shots-chase-- marker: chase scene appends below

/** Sunset police chase on the Coral Beach boulevard: Rook floors a Neon Comet
 *  with three wanted stars, four PD units in pursuit plus the GULLWATCH heli
 *  spotlight overhead, mission panel on The Getaway, HUD live, a drift popup
 *  queued. ~20s of real autopilot driving before the frame renders. */
function stageChase(ctx) {
  const { state, driver, onFoot, wanted, scene, camera } = ctx;

  freshState(ctx, { doneThrough: 2, money: 8400, day: 1, rep: 2, repXp: 20 });
  ctx.applySettings();
  ctx.ensureRadio();

  // Drop the parked starter mesh if it still exists, so it can't collide.
  if (ctx.parked) { scene.remove(ctx.parked.mesh); ctx.parked = null; }

  // Enter a Neon Comet on a north-south boulevard along the Coral Beach coast.
  const neon = (ctx.CARS || []).find((c) => c.name === 'Neon Comet') || ctx.CARS[2];
  const x = -141;   // road centreline on the west (coast) side of the grid
  const z = -70;
  driver.enterCar(neon, { x, y: 0, z });
  onFoot.hide();   // Rook is behind the wheel now, not standing on the road
  state.inCar = true;
  state.currentCar = { name: neon.name, condition: 100, fuel: 100, nitro: 30 };
  state.speedKmh = 0;

  // Three-star manhunt: the wanted controller + police units do the rest.
  wanted.setStars(3);
  state.stars = 3;
  state.health = 64;
  state.armour = 20;

  // Mission panel: The Getaway, on the final (escape) stage.
  state.currentMission = 'The Getaway';
  state.missionStage = 'STAGE 3/3';
  state.missionNext = 'STAGE 3/3: Lose the three-star chase and the heli';
  state.missionTimer = null;

  // Chase camera follows the car.
  driver.updateCamera(camera, 0.016);
  camera.lookAt(x, 1.2, z);

  // ~6s of real driving + police pursuit along the boulevard.
  const snap = driveSnap();
  for (let i = 0; i < 360; i += 1) {
    ctx.stepWorld(STEP, snap);
  }

  // Re-assert the manhunt so the stars/heat survive the seconds until capture.
  wanted.setStars(3);
  state.stars = 3;
  state.heat = 80;

  // Leave the crosshair off the wheel and a drift payout popup on screen.
  state.pushPopup('DRIFT x2 +$100');
  state.driftScore += 200;
  state.money += 100;

  ctx.setScreen('play');
  ctx.hud.update(STEP);
  ctx.update(STEP, state.clockMinutes);
  return driveSnap();
}

// --shots-shootout-- marker: shootout scene appends below

/** On-foot shootout in Dockside at dusk: Rook behind cover with the Tide SMG,
 *  three Gulls closing with hostile markers overhead, health + armour bars
 *  live, crosshair on, and a muzzle flash caught mid-frame from the last
 *  trigger pull. */
function stageShootout(ctx) {
  const { state, onFoot, arsenal, enemies, combat, scene, camera } = ctx;

  freshState(ctx, { doneThrough: 3, money: 12300, day: 1, rep: 3, repXp: 60 });
  ctx.applySettings();
  ctx.ensureRadio();

  // Rook on foot on a Dockside road, braced for a fight.
  const px = 229;
  const pz = -67;
  onFoot.setPosition({ x: px, y: 0, z: pz }, 0);
  onFoot.show();
  state.inCar = false;

  // Tide SMG unlocked and in hand.
  state.rep = 3;
  arsenal.refillAll();
  arsenal.select(2);   // slot 2 (0-based) -> Tide SMG

  // Health + armour bars read as a fight already in progress.
  state.health = 78;
  state.armour = 46;

  // Three Gulls stand down the road, hostile markers up. High health so
  // sustained fire during capture does not clear the scene before the shot.
  for (let i = 0; i < 3; i += 1) {
    enemies.spawnEnemy('gull', { x: px - 9 - i * 3, z: pz }, { health: 500 });
  }

  // Frame the fight head-on: the camera already swings to aim via combat.
  camera.lookAt(px - 10, 1.2, pz);

  // ~1.6s of real combat: Rook holds the trigger so a muzzle flash is live.
  for (let i = 0; i < 96; i += 1) {
    ctx.stepWorld(STEP, shootSnap(true));
  }

  ctx.setScreen('play');
  ctx.hud.update(STEP);
  ctx.update(STEP, state.clockMinutes);
  return shootSnap(true);
}

// --shots-menu-- marker: menu scene appends below

/** The title menu over the sunset city: menu open with CONTINUE showing the
 *  mid-story save, the character roster visible, and the slow camera orbit
 *  running so the skyline reads behind the panel. */
function stageMenu(ctx) {
  const { state } = ctx;

  // A believable Ch.5 save: five chapters done, Ch.6 waiting.
  freshState(ctx, { doneThrough: 5, money: 31420, day: 3, rep: 4, repXp: 220 });
  state.health = 88;
  state.armour = 25;
  state.shells = 9;
  state.carsStolen = 14;
  state.takedowns = 6;
  state.escapes = 3;

  ctx.applySettings();
  ctx.ensureRadio();

  // Open the menu screen; menuRefresh() rebuilds CONTINUE from the save above.
  ctx.setScreen('menu');

  ctx.hud.update(STEP);
  ctx.update(STEP, state.clockMinutes);
}

// --shots-map-- marker: map scene appends below

/** The full map screen open over the island: districts, the mission list,
 *  career stats and the legend in the side panel, player + police blips on
 *  the canvas. */
function stageMap(ctx) {
  const { state } = ctx;

  // A mid-story career for the stats panel + mission list.
  freshState(ctx, { doneThrough: 4, money: 31420, day: 2, rep: 4, repXp: 175 });
  state.shells = 6;
  state.carsStolen = 11;
  state.takedowns = 9;
  state.escapes = 5;
  state.playSeconds = 3874;

  ctx.applySettings();
  ctx.ensureRadio();

  // Open the map; createMap() builds the canvas + panel from state.
  ctx.setScreen('map');

  ctx.hud.update(STEP);
  ctx.update(STEP, state.clockMinutes);
}