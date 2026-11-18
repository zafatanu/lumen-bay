// LUMEN BAY traffic + pedestrians: cars cruise the road grid, pedestrians
// walk the sidewalks and cross at crosswalks, and both flee from cars.
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
  const def = { ...pick(rng, CARS), colour: pick(rng, [0xffffff, 0x9aa3ae, 0xd2a23b, 0x4fb3ff, 0x7a7f88, 0xd2473b, 0x3c8f4f]) };
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
  tc.speed = rand(rng, 8, 13);
  tc.turnTimer = rand(rng, 4, 14);
  tc.mesh.position.copy(tc.pos);
  tc.mesh.rotation.y = tc.heading;
}

/** Move a traffic car along its road lane; turn or continue at intersections. */
function moveTraffic(tc, dt, rng) {
  const travel = tc.axis;
  const along = tc.pos[travel];
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

/** A low-poly pedestrian: capsule body + head, varied shirt colour. */
function makePedestrian(rng) {
  const group = new THREE.Group();
  const shirt = pick(rng, [0xff5a6b, 0x4fb3ff, 0x8bff5a, 0xffd23b, 0xd2478f, 0x8a9aa3, 0xffffff]);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.9 });
  const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.7, 6);
  for (const lx of [0.14, -0.14]) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(lx, 0.35, 0);
    group.add(leg);
  }
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.62, 6), new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 }));
  body.position.y = 0.9;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd9a87c, roughness: 0.9 }));
  head.position.y = 1.45;
  group.add(head);
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
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
  ped.speed = rand(rng, 1.1, 1.6);
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
    return;
  }
  if (ped.flee > 0) {
    ped.flee -= dt;
    ped.speed = 5.5;
  } else if (ped.crossTimer > 0) {
    ped.crossTimer -= dt;
    ped.speed = rand(rng, 1.1, 1.6);
  } else {
    // At a crosswalk, hop to the far sidewalk and cross the road.
    ped.crossing = rand(rng, 3, 8);
    ped.crossTimer = rand(rng, 9, 20);
    ped.side *= -1;
    ped.dir *= 1;
    ped.speed = 2.2;
  }
  if (ped.crossing > 0) ped.crossing -= dt;
  ped.pos[travel] += ped.dir * ped.speed * dt;
  ped.pos[off] = ped.roadVal + ped.side;
  ped.mesh.position.copy(ped.pos);
  ped.mesh.rotation.y = ped.heading;
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
    const tc = { def, mesh, pos: new THREE.Vector3(), axis: 'x', dir: 1, roadVal: 0, laneOff: 3, heading: 0, speed: 10, turnTimer: 0, driver: true, visible: true };
    initTrafficCar(tc, rng);
    scene.add(mesh);
    cars.push(tc);
  }

  // 24 pedestrians on sidewalks.
  for (let i = 0; i < 24; i += 1) {
    const mesh = makePedestrian(rng);
    const ped = { mesh, pos: new THREE.Vector3(), axis: 'x', dir: 1, roadVal: 0, side: 0, heading: 0, speed: 1.4, crossTimer: 10, flee: 0 };
    initPedestrian(ped, rng);
    scene.add(mesh);
    peds.push(ped);
  }

  function update(dt, playerPos, playerSpeedKmh) {
    // Traffic cars.
    for (const tc of cars) {
      if (!tc.visible) continue;   // stolen cars are the player's now
      if (tc.pos.distanceTo(playerPos) > 150) respawnTraffic(tc, rng, playerPos);
      moveTraffic(tc, dt, rng);
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