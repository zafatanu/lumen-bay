// LUMEN BAY traffic + pedestrians: cars cruise the road grid, pedestrians
// walk the sidewalks and cross at crosswalks, and both flee from cars.
// The traffic layer stays lightweight: a fixed pool of cars is recycled, so
// a crowded boulevard never allocates new meshes during a chase.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { CARS, buildCarMesh } from './cars.js';
import { pick, rand } from '../random.js';

/** Centerline of road lane i. */
function roadLine(i) {
  const west = -WORLD.total / 2;
  return west + i * (WORLD.block + WORLD.road);
}

const HALF = WORLD.road / 2; // 7m to a road edge

function headingFor(axis, dir) {
  if (axis === 'x') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

/** Build a traffic car mesh from a random catalog entry. */
function makeTrafficCar(rng) {
  const def = { ...pick(rng, CARS), colour: pick(rng, [0xffffff, 0x9aa3ae, 0xd2a23b, 0x4fb3ff, 0x7a7f88, 0xd2473b, 0x3c8f4f, 0xe8e4d8, 0x5a6b80, 0x9c5f3c]) };
  const mesh = buildCarMesh(def);
  return { def, mesh };
}

/** Initialise a traffic car on a random road lane heading across the island. */
function initTrafficCar(tc, rng) {
  const axis = rng() < 0.5 ? 'x' : 'z';
  const dir = rng() < 0.5 ? 1 : -1;
  const idx = 1 + Math.floor(rng() * (WORLD.blocks - 1));
  const road = roadLine(idx);
  const laneOff = dir > 0 ? -3 : 3;
  tc.axis = axis;
  tc.dir = dir;
  tc.roadVal = road;
  tc.laneOff = laneOff;
  if (axis === 'x') {
    tc.pos.set((rng() - 0.5) * WORLD.total, 0, road + laneOff);
    tc.pos.z = road + laneOff;
  } else {
    tc.pos.set(road + laneOff, 0, (rng() - 0.5) * WORLD.total);
    tc.pos.x = road + laneOff;
  }
  tc.heading = headingFor(axis, dir);
  tc.cruise = rand(rng, 7, 14); // each car keeps its own cruising pace
  tc.speed = tc.cruise;
  tc.gap = rand(rng, 8, 20);    // preferred following distance, varied per car
  tc.turnTimer = rand(rng, 4, 14);
  tc.mesh.position.copy(tc.pos);
  tc.mesh.rotation.y = tc.heading;
}

/** Move a traffic car along its road lane; turn or continue at intersections. */
function moveTraffic(tc, dt, rng, cars) {
  const travel = tc.axis;
  const along = tc.pos[travel];
  // Ease off behind a car ahead in the same lane; each car keeps its own gap.
  tc.speed = tc.cruise;
  for (const other of cars) {
    if (other === tc || !other.visible || other.axis !== travel || other.dir !== tc.dir || other.roadVal !== tc.roadVal) continue;
    const ahead = (other.pos[travel] - along) * tc.dir;
    if (ahead > 0 && ahead < tc.gap) tc.speed = Math.min(tc.speed, other.speed);
  }
  // Steer around an occasional random turn when we reach the next crossing.
  tc.turnTimer -= dt;
  const next = roadLine(nearestIndex(along, tc.dir));
  if (tc.turnTimer <= 0 && Math.abs(along - next) < tc.speed * dt * 2) {
    turnTraffic(tc, rng);
  }
  tc.pos[travel] += tc.dir * tc.speed * dt;
  const off = tc.axis === 'x' ? 'z' : 'x';
  tc.pos[off] = tc.roadVal + tc.laneOff;
  tc.mesh.position.copy(tc.pos);
  tc.mesh.rotation.y = tc.heading;
}

/** Index of the next road line ahead of the car along its travel axis. */
function nearestIndex(along, dir) {
  const west = -WORLD.total / 2;
  const step = WORLD.block + WORLD.road;
  // Next line strictly ahead in the travel direction, clamped to the grid.
  let i = Math.round((along - west) / step);
  if (dir > 0 && along >= roadLine(i)) i += 1;
  if (dir < 0 && along <= roadLine(i)) i -= 1;
  return Math.max(1, Math.min(WORLD.blocks - 1, i));
}

/** Turn a traffic car onto a perpendicular road lane at an intersection. */
function turnTraffic(tc, rng) {
  const axis = tc.axis === 'x' ? 'z' : 'x';
  const dir = rng() < 0.5 ? 1 : -1;
  const laneOff = dir > 0 ? -3 : 3;
  // Snap to the intersection coordinate on the current travel axis.
  const idx = nearestIndex(tc.pos[tc.axis], tc.dir);
  tc.roadVal = roadLine(idx);
  tc.axis = axis;
  tc.dir = dir;
  tc.laneOff = laneOff;
  tc.pos[axis === 'x' ? 'x' : 'z'] = tc.roadVal + laneOff;
  tc.heading = headingFor(axis, dir);
  tc.turnTimer = rand(rng, 5, 16);
}

/** Respawn a traffic car somewhere far from the player. */
function respawnTraffic(tc, rng, playerPos) {
  let guard = 0;
  do {
    initTrafficCar(tc, rng);
    guard += 1;
  } while (tc.pos.distanceTo(playerPos) < 60 && guard < 20);
}

/** A low-poly pedestrian: legs, body, head and arms, varied colours and height.
 *  Limbs hang from hip/shoulder pivots so the walk cycle can swing them. */
function makePedestrian(rng) {
  const group = new THREE.Group();
  const shirt = pick(rng, [0xff5a6b, 0x4fb3ff, 0x8bff5a, 0xffd23b, 0xd2478f, 0x8a9aa3, 0xffffff, 0xf2a65a, 0x46627f, 0x9a6b4f, 0xc7bfae]);
  const skin = pick(rng, [0xf0c8a0, 0xd9a87c, 0xb07b4f, 0x8a5a3b, 0x5f3d26]);
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 });
  const legMat = new THREE.MeshStandardMaterial({ color: pick(rng, [0x2a3138, 0x39434e, 0x4d3f2c, 0x20242b]), roughness: 0.9 });
  function limb(x, y, geo, mat, len) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = -len / 2;
    pivot.add(m);
    group.add(pivot);
    return pivot;
  }
  const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.7, 6);
  const armGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.55, 6);
  const legL = limb(0.14, 0.7, legGeo, legMat, 0.7);
  const legR = limb(-0.14, 0.7, legGeo, legMat, 0.7);
  const armL = limb(0.3, 1.15, armGeo, shirtMat, 0.55);
  const armR = limb(-0.3, 1.15, armGeo, shirtMat, 0.55);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.62, 6), shirtMat);
  body.position.y = 0.9;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.9 }));
  head.position.y = 1.45;
  group.add(head);
  group.scale.setScalar(rand(rng, 0.92, 1.06)); // varied heights
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.userData.limbs = { legL, legR, armL, armR, head };
  return group;
}

/** Place a pedestrian on a sidewalk (just off a road edge) and head along it. */
function initPedestrian(ped, rng) {
  const axis = rng() < 0.5 ? 'x' : 'z';
  const dir = rng() < 0.5 ? 1 : -1;
  const idx = 1 + Math.floor(rng() * (WORLD.blocks - 1));
  const road = roadLine(idx);
  const side = (rng() < 0.5 ? 1 : -1) * (HALF + 3);
  ped.axis = axis;
  ped.dir = dir;
  ped.walkSpeed = rand(rng, 1.0, 1.8);   // each pedestrian keeps their own pace
  ped.speed = ped.walkSpeed;
  ped.cadence = rand(rng, 5, 8);         // gait cycle speed, varied step timing
  ped.swing = rand(rng, 0.35, 0.6);      // stride and arm-swing amplitude
  ped.phase = rand(rng, 0, Math.PI * 2); // desynchronise the crowd
  ped.look = rand(rng, 0, 6);
  ped.pause = 0;
  ped.roadVal = road;
  ped.side = side;
  if (axis === 'x') {
    ped.pos.set((rng() - 0.5) * WORLD.total, 0, road + side);
  } else {
    ped.pos.set(road + side, 0, (rng() - 0.5) * WORLD.total);
  }
  ped.heading = headingFor(axis, dir);
  ped.crossTimer = rand(rng, 6, 20);
  ped.mesh.position.copy(ped.pos);
  ped.mesh.rotation.y = ped.heading;
  ped.flee = 0;
}

/** Swing arms and legs at the pedestrian's own cadence; idle peds look around. */
function animatePed(ped, dt) {
  const { legL, legR, armL, armR, head } = ped.mesh.userData.limbs;
  ped.phase += dt * ped.cadence * Math.min(ped.speed / 1.4, 1.4);
  const s = Math.sin(ped.phase) * ped.swing * Math.min(ped.speed / 1.2, 1);
  legL.rotation.x = s;
  legR.rotation.x = -s;
  armL.rotation.x = -s * 0.8;
  armR.rotation.x = s * 0.8;
  ped.look += dt;
  head.rotation.y = ped.speed < 0.1 ? Math.sin(ped.look * 0.7) * 0.55 : 0;
}

/** Move a pedestrian; cross at crosswalks, flee when a car is near. */
function movePedestrian(ped, dt, rng, cars) {
  const travel = ped.axis;
  const off = travel === 'x' ? 'z' : 'x';
  let fleeing = false;
  let away = 0;
  for (const c of cars) {
    const d = c.mesh.position.x - ped.mesh.position.x;
    const a = c.mesh.position.z - ped.mesh.position.z;
    if (Math.hypot(d, a) < 7) { fleeing = true; away = Math.atan2(d, a); break; }
  }
  if (fleeing) {
    // Run away from the nearby car, then resume normal walking.
    ped.flee = 1.2;
    ped.speed = 5.5;
    ped.heading = away + Math.PI;
    ped.pos[travel] += Math.sin(ped.heading) * ped.speed * dt;
    ped.pos[off] = ped.roadVal + ped.side;
    ped.mesh.position.copy(ped.pos);
    ped.mesh.rotation.y = ped.heading;
    animatePed(ped, dt);
    return;
  }
  if (ped.flee > 0) {
    ped.flee -= dt;
    ped.speed = 5.5;
  } else if (ped.pause > 0) {
    // Idle: stand on the sidewalk and look around instead of marching.
    ped.pause -= dt;
    ped.speed = 0;
  } else if (ped.crossTimer > 0) {
    ped.crossTimer -= dt;
    ped.speed = ped.walkSpeed;
    // Now and then a pedestrian stops to look around mid-walk.
    if (rng() < dt * 0.05) ped.pause = rand(rng, 1.5, 4);
  } else {
    // At a crosswalk, hop to the far sidewalk and cross the road.
    ped.crossing = rand(rng, 3, 8);
    ped.crossTimer = rand(rng, 9, 20);
    ped.side *= -1;
    ped.dir *= 1;
    ped.speed = 2.2;
    // Some wait a beat at the curb before walking on.
    if (rng() < 0.5) ped.pause = rand(rng, 0.6, 2.5);
  }
  if (ped.crossing > 0) ped.crossing -= dt;
  ped.pos[travel] += ped.dir * ped.speed * dt;
  ped.pos[off] = ped.roadVal + ped.side;
  ped.mesh.position.copy(ped.pos);
  ped.mesh.rotation.y = ped.heading;
  animatePed(ped, dt);
}

/** The shared traffic + pedestrian controller. */
export function createTraffic(scene, city, rng) {
  const cars = [];
  const peds = [];
  let nearMissFlag = false;
  let nearMissCount = 0;

  // 14 traffic cars.
  for (let i = 0; i < 14; i += 1) {
    const { def, mesh } = makeTrafficCar(rng);
    const tc = { def, mesh, pos: new THREE.Vector3(), axis: 'x', dir: 1, roadVal: 0, laneOff: 3, heading: 0, cruise: 10, speed: 10, gap: 12, turnTimer: 0, driver: true, visible: true };
    initTrafficCar(tc, rng);
    scene.add(mesh);
    cars.push(tc);
  }

  // 24 pedestrians on sidewalks.
  for (let i = 0; i < 24; i += 1) {
    const mesh = makePedestrian(rng);
    const ped = { mesh, pos: new THREE.Vector3(), axis: 'x', dir: 1, roadVal: 0, side: 0, heading: 0, walkSpeed: 1.4, speed: 1.4, cadence: 6, swing: 0.45, phase: 0, look: 0, pause: 0, crossTimer: 10, flee: 0 };
    initPedestrian(ped, rng);
    scene.add(mesh);
    peds.push(ped);
  }

  function update(dt, playerPos, playerSpeedKmh) {
    // Traffic cars.
    for (const tc of cars) {
      if (!tc.visible) continue;   // stolen cars are the player's now
      if (tc.pos.distanceTo(playerPos) > 150) respawnTraffic(tc, rng, playerPos);
      moveTraffic(tc, dt, rng, cars);
    }
    // Pedestrians.
    for (const ped of peds) {
      if (ped.pos.distanceTo(playerPos) > 150) initPedestrian(ped, rng);
      movePedestrian(ped, dt, rng, cars);
    }
    // Near-miss: within 2m of any visible traffic car or pedestrian while fast.
    nearMissFlag = false;
    if (playerSpeedKmh > 60) {
      for (const tc of cars) {
        if (!tc.visible) continue;   // a stolen car is the player's, not a target
        if (tc.pos.distanceTo(playerPos) < 2) { nearMissFlag = true; nearMissCount += 1; break; }
      }
      if (!nearMissFlag) {
        for (const ped of peds) {
          if (ped.pos.distanceTo(playerPos) < 2) { nearMissFlag = true; nearMissCount += 1; break; }
        }
      }
    }
    return { nearMiss: nearMissFlag, nearMissCount };
  }

  return { update, cars, peds, get nearMiss() { return nearMissFlag; }, get nearMissCount() { return nearMissCount; } };
}