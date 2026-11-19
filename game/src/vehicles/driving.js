// LUMEN BAY arcade driving: throttle/brake/reverse, speed-sensitive steering,
// handbrake drift, nitro, fuel, condition, and a chase camera.
import * as THREE from 'three';
import { WORLD, CAR, CAMERA } from '../config.js';
import { buildCarMesh, makeGlowTexture } from './cars.js';

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

/** Fraction of the XZ segment (ox,oz)->(tx,tz) that stays inside the union
 *  of city.colliders. Those AABBs ({x,z,w,d}) are the road strips, so the
 *  segment leaving their union is the moment it enters a building block.
 *  Returns 1 when fully clear, otherwise the exit fraction in [0,1]. */
function roadUnionExit(colliders, ox, oz, tx, tz) {
  const dx = tx - ox;
  const dz = tz - oz;
  const spans = [];
  for (const b of colliders) {
    const minX = b.x - b.w / 2, maxX = b.x + b.w / 2;
    const minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) {
      if (ox < minX || ox > maxX) continue;
    } else {
      let a = (minX - ox) / dx, c = (maxX - ox) / dx;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < minZ || oz > maxZ) continue;
    } else {
      let a = (minZ - oz) / dz, c = (maxZ - oz) / dz;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) continue;
    }
    spans.push([t0, t1]);
  }
  if (!spans.length) return 0;
  spans.sort((a, b) => a[0] - b[0]);
  if (spans[0][0] > 0) return 0;   // origin off the road union: no clearance
  // Merge overlapping spans; the merged span covering t=0 (the car is
  // always on a road) ends where the segment first leaves the road union.
  let end = spans[0][1];
  for (let i = 1; i < spans.length; i += 1) {
    if (spans[i][0] > end) break;
    end = Math.max(end, spans[i][1]);
  }
  return Math.min(1, end);
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
  let heroCam = false;     // staged cover framing (?stage=chase only)

  // --- Visual-only body feel (mesh transforms, never physics): eased yaw
  // and steer angle, plus spring-damped roll on steering and pitch on
  // accel/brake so the body leans with weight instead of staying rigid.
  let visYaw = 0;          // mesh yaw, eases toward the physics heading
  let visSteer = 0;        // front-wheel angle, eases toward steering
  let roll = 0, rollV = 0;
  let pitch = 0, pitchV = 0;
  let prevSpeed = 0;       // for the visual accel/brake pitch target

  // --- Tire smoke: a small capped pool of soft sprites at the rear wheels.
  // Visual only — it never touches speed, steering or collision. A tiny LCG
  // keeps the jitter deterministic so a staged frame reproduces from a seed.
  const smoke = [];
  const SMOKE_MAX = 36;
  let smokeAcc = 0;
  let smokeSeed = 987654321;
  function smokeRand() {
    smokeSeed = (smokeSeed * 16807) % 2147483647;
    return smokeSeed / 2147483647;
  }
  function puffSmoke() {
    if (smoke.length >= SMOKE_MAX) return;
    const tex = makeGlowTexture();
    const side = smokeRand() < 0.5 ? 1 : -1;
    // Rear wheel in car-local space, rotated into the world by the heading.
    const lx = side * 1.05;
    const lz = -1.3;
    const wx = pos.x + lx * Math.cos(heading) + lz * Math.sin(heading);
    const wz = pos.z - lx * Math.sin(heading) + lz * Math.cos(heading);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xd8c8b8, transparent: true, opacity: 0.38, depthWrite: false,
    }));
    sprite.position.set(wx, 0.18, wz);
    sprite.scale.set(0.7, 0.7, 1);
    scene.add(sprite);
    smoke.push({
      sprite, age: 0, life: 0.8 + smokeRand() * 0.5,
      vx: (smokeRand() - 0.5) * 0.9 - Math.sin(heading) * 0.6,
      vy: 0.9 + smokeRand() * 0.9,
      vz: (smokeRand() - 0.5) * 0.9 - Math.cos(heading) * 0.6,
    });
  }
  function updateSmoke(dt) {
    for (let i = smoke.length - 1; i >= 0; i -= 1) {
      const p = smoke[i];
      p.age += dt;
      if (p.age >= p.life) {
        scene.remove(p.sprite);
        p.sprite.material.dispose();
        smoke.splice(i, 1);
        continue;
      }
      const t = p.age / p.life;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      const s = 0.8 + t * 2.4;
      p.sprite.scale.set(s, s, 1);
      p.sprite.material.opacity = 0.38 * (1 - t);
    }
  }
  function clearSmoke() {
    for (const p of smoke) {
      scene.remove(p.sprite);
      p.sprite.material.dispose();
    }
    smoke.length = 0;
  }

  function speedKmh() {
    return Math.abs(speed) * 3.6;
  }

  function enterCar(carDef, position, startHeading = 0) {
    if (car) return;
    def = carDef;
    car = buildCarMesh(def);
    pos.copy(position);
    pos.y = 0;
    // Optional facing for live staging (?stage=chase); normal play always 0.
    heading = startHeading;
    speed = 0;
    fuel = 100;
    nitro = CAR.nitroMax;
    car.position.copy(pos);
    car.rotation.y = heading;
    visYaw = heading;   // visual layer starts aligned, no snap on entry
    visSteer = 0;
    roll = rollV = pitch = pitchV = 0;
    prevSpeed = 0;
    scene.add(car);
  }

  function exitCar() {
    if (!car) return null;
    scene.remove(car);
    clearSmoke();      // no frozen puffs left hanging over the road
    heroCam = false;   // staged framing ends with the staged drive
    const drop = pos.clone();
    car = null;
    def = null;
    return drop;
  }

  function update(dt, input) {
    updateSmoke(dt);
    if (!car) {
      speed = 0;
      return;
    }
    const top = def.topSpeed;
    const accel = def.accel;

    // --- Throttle / brake / reverse. A totaled car (condition 0) is immobile. ---
    // Throttle is clamped to topSpeed, reverse tops out at CAR.reverse, and a
    // dead car just coasts to a stop so a wrecked ride can't be steered around.
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

    // --- Tire smoke: hard launches (wheelspin off the line) and drifts.
    // Capped at ~30 puffs/s and SMOKE_MAX sprites; purely visual. A totaled
    // or fuel-stalled car can't spin its wheels, so it gets no launch smoke. ---
    const hardAccel = condition > 0 && fuel > 0 && input.up && speed >= 0 && speed < 14;
    if (drifting || hardAccel) {
      smokeAcc += dt;
      while (smokeAcc >= 1 / 30) {
        smokeAcc -= 1 / 30;
        puffSmoke();
      }
    } else {
      smokeAcc = 0;
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

    // --- Visual layer only: mesh transforms below never feed back into
    // speed, heading, pos or collision. Eased yaw + spring-damped roll on
    // steering and pitch on accel/brake give the body a sense of weight.
    const vdt = Math.min(dt, 0.05);   // clamp so springs stay stable on lag spikes
    visYaw += (heading - visYaw) * Math.min(1, vdt * 12);
    visSteer += (steering - visSteer) * Math.min(1, vdt * 9);
    const accelG = (speed - prevSpeed) / Math.max(dt, 1e-4);
    prevSpeed = speed;
    // Lean outward in turns; nose up under throttle, dive under braking.
    const rollT = THREE.MathUtils.clamp(steering * speedFactor, -1.4, 1.4) * 0.055;
    const pitchT = THREE.MathUtils.clamp(-accelG * 0.004, -0.06, 0.06);
    rollV += ((rollT - roll) * 40 - rollV * 9) * vdt;
    roll += rollV * vdt;
    pitchV += ((pitchT - pitch) * 50 - pitchV * 10) * vdt;
    pitch += pitchV * vdt;
    car.rotation.set(pitch, visYaw, roll);

    // Wheels roll with the distance travelled around their local X axle
    // (see cars.js); the front pair eases toward the steering input on Y.
    const spin = (speed / 0.34) * dt;
    const wheelAngle = THREE.MathUtils.clamp(visSteer * 0.35, -0.5, 0.5);
    for (const child of car.children) {
      if (child.userData && child.userData.wheel) {
        child.rotation.x += spin;
        if (child.position.z > 0) child.rotation.y = wheelAngle;
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

  /** Chase camera: smooth follow behind the car; FOV widens with speed.
   *  In hero mode (set only by the ?stage=chase / ?shot=1-chase staging) it
   *  swaps to the cover framing: low rear three-quarter, car large in the
   *  lower frame, tilted up so GULLWATCH and its beam stay in shot. Normal
   *  gameplay never sets hero mode, so the default camera is untouched. */
  function updateCamera(camera, dt) {
    if (heroCam) {
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      const rx = -Math.cos(heading);   // screen-right of the travel direction
      const rz = Math.sin(heading);
      const back = 10.5;
      const side = 4.0;
      // Camera sits on the left kerb of the travel direction and looks
      // across the car toward the sun side, so the ocean glow leads the
      // frame and the car holds low in the frame, just off centre.
      camera.position.set(
        pos.x - fx * back - rx * side,
        pos.y + 1.6,
        pos.z - fz * back - rz * side
      );
      // Look ahead of the car, biased toward the sun and lifted so the
      // frame spans the low car AND the heli hovering 40m above it, with
      // margin under the top HUD strip.
      camera.lookAt(
        pos.x + fx * 10 + rx * 3,
        pos.y + 15.5,
        pos.z + fz * 10 + rz * 3
      );
      camera.fov += (94 - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
      return;
    }
    const back = 6.5 + speedKmh() * 0.05;
    const up = 2.6 + speedKmh() * 0.02;
    let bx = pos.x - Math.sin(heading) * back;
    let bz = pos.z - Math.cos(heading) * back;
    let by = pos.y + up;
    // Occlusion: cast from the car to the desired camera spot against the
    // road-strip AABBs (city.colliders); where the segment leaves the road
    // union, pull the target in to hit distance minus a margin. Only ever
    // shortens the distance — the lerp smoothing below is unchanged.
    if (city.colliders && city.colliders.length) {
      const hx = pos.x, hy = pos.y + 1.2, hz = pos.z;
      const t = roadUnionExit(city.colliders, hx, hz, bx, bz);
      if (t < 1) {
        const dx = bx - hx, dz = bz - hz;
        const len = Math.hypot(dx, dz);
        // Margin covers the 0.5 near plane; the 3.0 floor keeps the camera
        // behind the car's rear bumper (body half-length ~2.05) when the car
        // sits at a road edge. Building faces are 5.4m inside the block
        // edge, so this stays clear of them.
        const allow = len > 1e-6 ? Math.min(len, Math.max(3.0, t * len - 0.6)) / len : 0;
        bx = hx + dx * allow;
        bz = hz + dz * allow;
        by = hy + (by - hy) * allow;
      }
    }
    // Ease position and look toward the same targets as before — only the
    // approach is smoothed, so turns swing instead of snapping.
    const k = Math.min(1, dt * 8);
    camera.position.x += (bx - camera.position.x) * k;
    camera.position.y += (by - camera.position.y) * k;
    camera.position.z += (bz - camera.position.z) * k;
    if (camera.position.y < 0.5) camera.position.y = 0.5;
    const tx = pos.x, ty = pos.y + 1.2, tz = pos.z;
    let look = camera.userData.driveLook;
    if (!look) { look = new THREE.Vector3(tx, ty, tz); camera.userData.driveLook = look; }
    const dx = tx - look.x, dy = ty - look.y, dz = tz - look.z;
    if (dx * dx + dy * dy + dz * dz > 144) look.set(tx, ty, tz);  // teleport: snap, don't sweep
    const lk = Math.min(1, dt * 10);
    look.x += (tx - look.x) * lk;
    look.y += (ty - look.y) * lk;
    look.z += (tz - look.z) * lk;
    camera.lookAt(look.x, look.y, look.z);
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
    setHeroCamera: (on) => { heroCam = !!on; },
    speedKmh,
    drifting: () => drifting,
    get driftScore() { return driftScore; },
    get heading() { return heading; },
  };
}