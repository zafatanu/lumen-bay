// LUMEN BAY arcade driving: throttle/brake/reverse, speed-sensitive steering,
// handbrake drift, nitro, fuel, condition, and a chase camera.
import * as THREE from 'three';
import { WORLD, CAR, CAMERA } from '../config.js';
import { buildCarMesh } from './cars.js';

/** Centerline x of road lane i (i in 0..WORLD.blocks). */
function roadLine(i) {
  const west = -WORLD.total / 2;
  return west + i * (WORLD.block + WORLD.road);
}

/** Nearest road x-line and its signed distance to a coordinate. */
function nearestRoad(v) {
  let best = Infinity;
  let bestI = 0;
  for (let i = 0; i <= WORLD.blocks; i += 1) {
    const r = roadLine(i);
    const d = v - r;
    if (Math.abs(d) < Math.abs(best)) {
      best = d;
      bestI = i;
    }
  }
  return { line: roadLine(bestI), d: best };
}

/** Keep a car circle on the road grid; slide out of building blocks.
 *  Returns a 0..1 damage amount when the car was shoved off a building. */
function collideCity(pos, r, speed) {
  const nx = nearestRoad(pos.x);
  const nz = nearestRoad(pos.z);
  const xInside = Math.abs(nx.d) <= WORLD.road / 2 - r;
  const zInside = Math.abs(nz.d) <= WORLD.road / 2 - r;
  if (xInside || zInside) return 0;
  // Inside a building block: push toward the nearer road edge.
  const xPush = Math.abs(nx.d) - (WORLD.road / 2 - r);
  const zPush = Math.abs(nz.d) - (WORLD.road / 2 - r);
  if (xPush <= zPush) pos.x = nx.line + Math.sign(nx.d) * (WORLD.road / 2 - r);
  else pos.z = nz.line + Math.sign(nz.d) * (WORLD.road / 2 - r);
  return speed > 14 ? Math.min(1, (speed - 14) / 28) : 0;
}

/** Arcade driving controller. `state` is the shared game state, `city` carries
 *  the road grid, `scene` is where the car mesh lives while entered. */
export function createDriver(state, city, scene) {
  let car = null;          // THREE.Group while entered
  let def = null;          // catalog entry
  let speed = 0;           // forward scalar, m/s (negative while reversing)
  let heading = 0;         // yaw, +Z is forward at heading 0
  const pos = new THREE.Vector3();
  let steering = 0;        // smoothed steering input
  let fuel = 100;
  let nitro = CAR.nitroMax;
  let condition = 100;
  let drifting = false;
  let skid = 0;            // skid flag for the frame
  let driftScore = 0;      // accumulated drift score

  function speedKmh() {
    return Math.abs(speed) * 3.6;
  }

  function enterCar(carDef, position) {
    if (car) return;
    def = carDef;
    car = buildCarMesh(def);
    pos.copy(position);
    pos.y = 0;
    heading = 0;
    speed = 0;
    fuel = 100;
    nitro = CAR.nitroMax;
    car.position.copy(pos);
    scene.add(car);
  }

  function exitCar() {
    if (!car) return null;
    scene.remove(car);
    const drop = pos.clone();
    car = null;
    def = null;
    return drop;
  }

  function update(dt, input) {
    if (!car) {
      speed = 0;
      return;
    }
    const top = def.topSpeed;
    const accel = def.accel;

    // --- Throttle / brake / reverse. A totaled car (condition 0) is immobile. ---
    const drivable = condition > 0;
    if (drivable && input.up) {
      if (speed >= 0) speed = Math.min(top, speed + accel * dt);
      else speed = Math.min(0, speed + CAR.braking * dt * 1.6);
    } else if (drivable && input.down) {
      if (speed > 0.5) speed = Math.max(0, speed - CAR.braking * dt * 1.8);
      else speed = Math.max(CAR.reverse, speed - accel * dt * 0.7);
    } else {
      speed *= 1 - dt * 0.6;   // natural drag
      if (Math.abs(speed) < 0.05) speed = 0;
    }

    // --- Nitro: forward only, drains fast, refills slowly. ---
    if (input.jump && speed > 2) {
      nitro = Math.max(0, nitro - dt * 18);
      if (nitro > 0) speed = Math.min(top * 1.5, speed + CAR.nitroBoost * dt * 6);
    } else {
      nitro = Math.min(CAR.nitroMax, nitro + dt * 4);
    }

    // --- Fuel: drains while moving; empty means the car stalls. ---
    if (Math.abs(speed) > 0.5) fuel = Math.max(0, fuel - dt * 0.9);
    if (fuel <= 0) {
      speed *= 1 - dt * 2;
      if (Math.abs(speed) < 0.05) speed = 0;
    }

    // --- Speed-sensitive steering; handbrake tightens the turn. ---
    const speedFactor = THREE.MathUtils.clamp(speedKmh() / 60, 0, 1);
    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const target = steer * def.handling * (0.35 + 0.65 * speedFactor) * (input.handbrake ? 1.4 : 1);
    steering += (target - steering) * Math.min(1, dt * 6);
    heading += steering * dt * (2.4 + speedFactor * 3.2) * Math.sign(speed || 1);

    // --- Handbrake drift: rear slides, builds the drift score. ---
    drifting = input.handbrake && Math.abs(speed) > 18;
    if (drifting) {
      driftScore += speedKmh() * dt * 0.12;
      skid = 1;
    } else {
      driftScore *= 1 - dt * 2;
      skid = 0;
    }

    // --- Integrate position along heading. ---
    pos.x += Math.sin(heading) * speed * dt;
    pos.z += Math.cos(heading) * speed * dt;
    pos.y = 0;

    // --- Collide vs building blocks; slide along, damage on hard hits. ---
    const r = (car.userData.body && car.userData.body.r) || 0.3;
    const dmg = collideCity(pos, r, speed);
    if (dmg > 0) {
      condition = Math.max(0, condition - dmg * 10);
      speed *= 0.92;
    }

    car.position.copy(pos);
    car.rotation.y = heading;

    // Wheels spin with the distance travelled. Each wheel is an axle group
    // (see cars.js) that we roll around its local Z — the axle axis.
    const spin = (speed / 0.34) * dt;
    for (const child of car.children) {
      if (child.userData && child.userData.wheel) {
        child.rotation.z += spin * (child.position.z > 0 ? 1 : -1);
      }
    }

    // --- Update shared state. ---
    if (state) {
      state.currentCar = { name: def.name, condition, fuel, nitro };
      state.inCar = true;
      state.speedKmh = Math.round(speedKmh());
      state.driftScore = driftScore;
    }
  }

  /** Chase camera: smooth follow behind the car; FOV widens with speed. */
  function updateCamera(camera, dt) {
    const back = 6.5 + speedKmh() * 0.05;
    const up = 2.6 + speedKmh() * 0.02;
    const bx = pos.x - Math.sin(heading) * back;
    const bz = pos.z - Math.cos(heading) * back;
    camera.position.set(bx, pos.y + up, bz);
    camera.lookAt(pos.x, pos.y + 1.2, pos.z);
    const fovTarget = 55 + speedKmh() * 0.25;
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }

  return {
    // A live getter: the local `car` is reassigned by enterCar() after this
    // object is built, so a captured value would stay null forever and break
    // main.js when it reads driver.car.position for the traffic near-miss.
    get car() { return car; },
    enterCar,
    exitCar,
    update,
    updateCamera,
    speedKmh,
    drifting: () => drifting,
    get driftScore() { return driftScore; },
    get heading() { return heading; },
  };
}