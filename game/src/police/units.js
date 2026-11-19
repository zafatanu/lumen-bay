// LUMEN BAY police units: navy-white cruisers, a lone interceptor, roadblock
// teams and a spotter helicopter ("HELI 1 'GULLWATCH'"). They drive the road
// grid toward the player, ram his car, box him in when he stalls and — at high
// stars — light him up from the sky. Names are original to Lumen Bay; none are
// copied from any other game. Audio lives in the radio session; here it's
// purely visual (flashing light bars, a spotlight cone) plus the AI that chases.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { rand } from '../random.js';

const WEST = -WORLD.total / 2;
const STEP = WORLD.block + WORLD.road;
const HALF = WORLD.road / 2;

// Light bar flash phase drives the red/blue emissive swap on cruisers.
let lightPhase = 0;

/** A navy-white cruiser with a roof light bar and swappable red/blue lights.
 *  Oriented +Z forward like the traffic cars, so police can reuse the same
 *  road grid helper. */
function buildCruiser() {
  const group = new THREE.Group();
  const navy = new THREE.MeshStandardMaterial({ color: 0x1c2a52, roughness: 0.45, metalness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: 0.45, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1622, roughness: 0.15, metalness: 0.6 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 4.1), navy);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 3.9), white);
  belt.position.y = 0.96;
  group.add(belt);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.58, 2.0), navy);
  cab.position.set(0, 1.32, -0.2);
  cab.castShadow = true;
  group.add(cab);
  for (const [dx, dz, w, d] of [
    [0, 0.1, 0.2, 1.7],
    [0, -0.6, 0.2, 1.0],
    [0.74, -0.2, 0.16, 1.7],
    [-0.74, -0.2, 0.16, 1.7],
  ]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(w, 0.32, d), glass);
    win.position.set(dx, 1.32, dz);
    group.add(win);
  }
  // Roof light bar: two lamp boxes; their emissive colours swap every flash.
  const redMat = new THREE.MeshStandardMaterial({ color: 0x660000, emissive: 0xff2020, emissiveIntensity: 1.6 });
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x000a55, emissive: 0x2a6bff, emissiveIntensity: 0 });
  const redLamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.5), redMat);
  redLamp.position.set(-0.2, 1.72, -0.3);
  group.add(redLamp);
  const blueLamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.5), blueMat);
  blueLamp.position.set(0.2, 1.72, -0.3);
  group.add(blueLamp);

  // Wheels: four dark cylinders on axle groups so the driving code can roll.
  const tyre = new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.9 });
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.16, 10);
  for (const [x, z] of [[1.05, 1.25], [-1.05, 1.25], [1.05, -1.25], [-1.05, -1.25]]) {
    const axle = new THREE.Group();
    const w = new THREE.Mesh(wheelGeo, tyre);
    w.rotation.x = Math.PI / 2;
    axle.add(w);
    axle.position.set(x, 0.34, z);
    axle.userData.wheel = true;
    group.add(axle);
  }

  // Headlights and tail lights.
  const head = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd9a0, emissiveIntensity: 1.4 });
  for (const x of [0.55, -0.55]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.12), head);
    h.position.set(x, 0.74, 2.06);
    group.add(h);
  }
  const tail = new THREE.MeshStandardMaterial({ color: 0xff2f2f, emissive: 0xff2f2f, emissiveIntensity: 0.8 });
  for (const x of [0.6, -0.6]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.12), tail);
    t.position.set(x, 0.66, -2.06);
    group.add(t);
  }

  group.userData.body = { r: 0.5, length: 4.3 };
  group.userData.lights = { redMat, blueMat };
  return group;
}

/** Centreline of road lane i. */
function roadLine(i) {
  return WEST + i * STEP;
}

/** Nearest road line and signed offset for a coordinate. */
function nearestLine(v) {
  const i = Math.round((v - WEST) / STEP);
  return roadLine(Math.max(0, Math.min(WORLD.blocks, i)));
}

/** The original Lumen Bay PD roster. Each unit keeps a stable name. */
function roster(stars) {
  // Scale up with stars: 1->1-2 patrols, 2->3, 3->4 + heli, 4->5+heli+block,
  // 5->6+heli+block. The interceptor appears from 3 stars on.
  const names = [];
  const patrols = stars <= 1 ? (Math.random() < 0.5 ? 1 : 2) : stars;
  for (let i = 0; i < patrols && i < 6; i += 1) names.push(`PATROL ${i + 1}`);
  if (stars >= 3) names.push('INTERCEPTOR 1');
  if (stars >= 4) names.push('ROADBLOCK UNIT');
  return names;
}

/** The GULLWATCH spotter helicopter: a low-poly airframe with a spinning rotor
 *  and a spotlight cone that hangs above Rook. Never lands, hovers at 40m. */
function buildHeli() {
  const group = new THREE.Group();
  const navy = new THREE.MeshStandardMaterial({ color: 0x16224a, roughness: 0.5, metalness: 0.3 });
  const white = new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: 0.5, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1622, roughness: 0.15, metalness: 0.6 });

  // Fuselage.
  const fuse = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 2.8), navy);
  fuse.position.y = 0.5;
  group.add(fuse);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.8), white);
  nose.position.set(0, 0.5, -1.7);
  group.add(nose);
  // Tail boom.
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 1.8), white);
  boom.position.set(0, 0.55, 2.2);
  group.add(boom);
  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.1), navy);
  tailFin.position.set(0, 0.95, 3.0);
  group.add(tailFin);
  // Skids.
  const skid = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6);
  const skidMat = new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.9 });
  for (const x of [0.7, -0.7]) {
    const s = new THREE.Mesh(skid, skidMat);
    s.rotation.x = Math.PI / 2;
    s.position.set(x, 0.0, 0.4);
    group.add(s);
  }
  // Rotor: a flat disc on a spinning hub, driven from the update loop.
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.35), navy);
  rotor.position.y = 1.0;
  group.add(rotor);
  group.userData.rotor = rotor;
  return group;
}

/** The GULLWATCH spotlight: a translucent cone that tilts down at Rook and
 *  reads as a beam of light without any real light or shadow cost. */
function buildSpotlight() {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(6, 46, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.18, depthWrite: false })
  );
  cone.rotation.x = Math.PI;   // point down
  cone.position.y = -23;
  return cone;
}

/** Keep a car unit out of building blocks; slide it back to the nearer lane. */
function clampUnit(p) {
  const lx = nearestLine(p.x);
  const lz = nearestLine(p.z);
  if (Math.abs(p.x - lx) <= HALF - 0.6) return;
  if (Math.abs(p.z - lz) <= HALF - 0.6) return;
  const dx = Math.abs(p.x - lx);
  const dz = Math.abs(p.z - lz);
  if (dx <= dz) p.x = lx + Math.sign(p.x - lx) * (HALF - 0.6);
  else p.z = lz + Math.sign(p.z - lz) * (HALF - 0.6);
}

/** Wrap an angle to (-PI, PI]. */
function normAngle(a) {
  let r = (a + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
}

/** Police units controller. Builds cruisers from the roster, drives them at
 *  Rook, spawns the GULLWATCH heli at high stars and clears when he escapes. */
export function createPolice(scene, city, rng, wanted) {
  const units = [];
  let heli = null;        // helicopter { mesh, spot, state }
  const pos = new THREE.Vector3();
  let ramT = 0;          // global ram timer for light-bar flashing

  /** Spawn a cruiser unit with a roster name on a road lane near Rook. */
  function makeUnit(name, near) {
    const mesh = buildCruiser();
    scene.add(mesh);
    const p = new THREE.Vector3();
    let guard = 0;
    do {
      const axis = rng() < 0.5 ? 'x' : 'z';
      const line = nearestLine(near[axis]);
      if (axis === 'x') p.set(line + (rng() < 0.5 ? -1 : 1) * 60, 0, line + (rng() - 0.5) * 40);
      else p.set(line + (rng() - 0.5) * 40, 0, line + (rng() < 0.5 ? -1 : 1) * 60);
      clampUnit(p);
      guard += 1;
    } while (p.distanceTo(near) < 50 && guard < 10);
    const u = {
      name, mesh, pos: p,
      heading: Math.atan2(near.x - p.x, near.z - p.z),
      speed: 0, state: 'EN ROUTE',
      ram: 0, block: false, box: 0, lookT: 0,
    };
    units.push(u);
    return u;
  }

  /** Spawn the GULLWATCH helicopter (once) with a spotlight cone. */
  function spawnHeli() {
    if (heli) return;
    const mesh = buildHeli();
    const spot = buildSpotlight();
    scene.add(mesh);
    scene.add(spot);
    heli = { mesh, spot, state: 'SPOTLIGHT', seek: new THREE.Vector3() };
  }

  /** How many car units the current star level calls for. */
  function wantedCount() {
    const s = wanted.stars;
    if (s <= 1) return 2;
    if (s === 2) return 3;
    if (s === 3) return 4;
    if (s === 4) return 5;
    return 6;
  }

  /** Drive one car unit at Rook and pick its AI state for this step. */
  function updateCar(u, dt, target, inCar, playerSpeed) {
    const dx = target.x - u.pos.x;
    const dz = target.z - u.pos.z;
    const dist = Math.hypot(dx, dz);
    const toward = Math.atan2(dx, dz);
    const playerSlow = inCar && playerSpeed < 12 && dist < 22;

    // Pick a state from the situation each frame.
    if (dist < 3.2 && u.state !== 'RAMMING') u.state = 'RAMMING';
    else if (dist < 26 && inCar && !playerSlow) u.state = 'PURSUIT';
    else if (playerSlow) u.state = 'BOXING IN';
    else if (u.block) u.state = 'ROADBLOCK';
    else u.state = 'EN ROUTE';

    let speed = 16;
    if (u.state === 'PURSUIT') {
      speed = 24;
    } else if (u.state === 'RAMMING') {
      speed = 30;
      u.ram = 0.8;
    } else if (u.state === 'BOXING IN') {
      speed = dist > 10 ? 18 : 6;
    } else if (u.state === 'ROADBLOCK') {
      speed = 0;   // parked across the road
    } else {
      speed = 18;  // EN ROUTE
    }

    // Move toward Rook, staying on the road grid except when alongside for a ram.
    if (speed > 0) {
      let dHeading = normAngle(toward - u.heading);
      if (u.state === 'PURSUIT') u.heading += dHeading * Math.min(1, dt * 4);
      else if (u.state === 'RAMMING') u.heading += dHeading * Math.min(1, dt * 1.2);
      else u.heading += dHeading * Math.min(1, dt * 2);
      u.pos.x += Math.sin(u.heading) * speed * dt;
      u.pos.z += Math.cos(u.heading) * speed * dt;
      clampUnit(u.pos);
    }
    if (u.ram > 0) u.ram -= dt;

    u.mesh.position.copy(u.pos);
    u.mesh.rotation.y = u.heading;
    return { dist, toward };
  }

  /** Flash the light bar red/blue; ram flashes faster while in pursuit. */
  function flashLights(u, dt, hot) {
    if (!u.mesh.userData.lights) return;
    const { redMat, blueMat } = u.mesh.userData.lights;
    const rate = hot ? 14 : 5;
    lightPhase += dt * rate;
    const on = (Math.sin(lightPhase) > 0) ^ (u.state === 'RAMMING');
    redMat.emissiveIntensity = on ? 2.2 : 0;
    blueMat.emissiveIntensity = on ? 0 : 2.2;
  }

  /** Feed the HUD a compact roster row (name, distanceM, state). */
  function writeFeed(playerPos) {
    wanted.policeFeed.length = 0;
    for (const u of units) {
      wanted.policeFeed.push({
        name: u.name,
        distanceM: Math.round(u.pos.distanceTo(playerPos)),
        state: u.state,
      });
    }
    if (heli) {
      const d = Math.round(Math.hypot(playerPos.x - heli.mesh.position.x, playerPos.z - heli.mesh.position.z));
      wanted.policeFeed.push({ name: "HELI 1 'GULLWATCH'", distanceM: d, state: 'SPOTLIGHT' });
    }
  }

  /** Advance the whole police force one fixed step. Returns info main.js uses:
   *  `ram` a unit that is currently shoving the player's car, and `bust` a cop
   *  that just grabbed Rook on foot. */
  function update(dt, playerPos, playerVel, star, inCar, playerSpeedKmh) {
    const stars = star === undefined ? wanted.stars : star;
    const target = playerPos;

    // No heat: every unit and the heli stand down.
    if (stars <= 0) {
      clear();
      wanted.policeFeed.length = 0;
      return { ram: null, bust: false };
    }

    // Keep the roster at the star-appropriate strength.
    const need = wantedCount();
    while (units.length < need) {
      makeUnit(units.length ? units[0].name : `PATROL ${units.length + 1}`, target);
    }
    if (stars >= 3) spawnHeli();

    // A unit close enough to keep eyes on Rook counts as "seen".
    let seen = false;
    let nearestD = Infinity;
    for (const u of units) {
      const d = u.pos.distanceTo(target);
      if (d < nearestD) nearestD = d;
      if (d < 30) seen = true;
      updateCar(u, dt, target, inCar, playerSpeedKmh);
      flashLights(u, dt, d < 30);
    }

    // Ramming: a unit alongside the player's car shoves it.
    let ram = null;
    if (inCar) {
      for (const u of units) {
        if (u.state === 'RAMMING' && u.pos.distanceTo(target) < 6) {
          const dx = target.x - u.pos.x;
          const dz = target.z - u.pos.z;
          const l = Math.hypot(dx, dz) || 1;
          ram = { x: dx / l, z: dz / l };
          break;
        }
      }
    }

    // Busted: an on-foot cop grabs Rook. The wanted controller settles the fine.
    let bust = false;
    if (!inCar) {
      for (const u of units) {
        if (u.state === 'RAMMING' && u.pos.distanceTo(target) < 1.6) {
          bust = wanted.bust();
          break;
        }
      }
    }

    // The heli hovers 40m up, spins its rotor and drops the spotlight on Rook.
    if (heli) {
      const h = heli.mesh;
      h.position.x = target.x;
      h.position.z = target.z;
      h.position.y = 40;
      if (heli.mesh.userData.rotor) {
        heli.mesh.userData.rotor.rotation.y += dt * 24;
      }
      heli.spot.position.set(target.x, 0, target.z);
    }

    writeFeed(target);

    // Let the wanted controller advance its escape/decay timers.
    const boost = inCar && playerSpeedKmh > 45 && nearestD < 26 ? 0.4 : 0;
    wanted.update(dt, seen ? { x: target.x, z: target.z } : null, playerSpeedKmh, boost
      );
    return { ram, bust };
  }

  /** Tear down every unit and the heli. */
  function clear() {
    for (const u of units) scene.remove(u.mesh);
    units.length = 0;
    if (heli) {
      scene.remove(heli.mesh);
      scene.remove(heli.spot);
      heli = null;
    }
  }

  return {
    update,
    units: () => units,
    heliActive: () => !!heli,
    clear,
  };
}