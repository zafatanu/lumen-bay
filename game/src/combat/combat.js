// LUMEN BAY combat: crosshair, hip-fire aim, gunplay effects and all the
// damage plumbing between Rook and whoever is standing in front of him.
// Ammo, fire rate and reloading live in weapons.js; enemy AI lives in
// enemies.js. This module resolves hits, renders muzzle flashes and tracers,
// and applies hurt to both sides.
import * as THREE from 'three';

/** Muzzle height above Rook's feet ("gun at the chest"). */
const MUZZLE_Y = 1.22;
/** How far in front of Rook the muzzle floats, metres. */
const MUZZLE_FWD = 0.85;
/** Sideways offset: the gun sits in his right hand. */
const MUZZLE_SIDE = 0.32;
/** Tracer bolt travel speed, m/s (visual only). */
const TRACER_SPEED = 220;
/** Half-arc of a fist swing in front of Rook, radians. */
const MELEE_ARC = 1.0;
/** How far a fist swing reaches, metres. */
const MELEE_REACH = 2.2;
/** Fraction of an incoming round that armour eats while it lasts. */
const ARMOUR_SOAK = 0.6;

/** Cone test for forgiving gun aim: cos of the half-angle a round may stray. */
const AIM_CONE = 0.94;

const UP = new THREE.Vector3(0, 1, 0);

/** Wrap an angle into (-PI, PI]. */
function normAngle(a) {
  let r = (a + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
}

/** Turn `from` toward `to` by at most `step` radians. */
function turnToward(from, to, step) {
  const d = normAngle(to - from);
  if (Math.abs(d) <= step) return to;
  return from + Math.sign(d) * step;
}

/** Additive radial-gradient billboard texture, built once per kind. */
function makeGlowTexture(core) {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, core);
  grad.addColorStop(0.3, 'rgba(255,236,190,0.75)');
  grad.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let flashTex = null;
let sparkTex = null;
function getFlashTex() {
  if (!flashTex) flashTex = makeGlowTexture('rgba(255,250,225,1)');
  return flashTex;
}
function getSparkTex() {
  if (!sparkTex) sparkTex = makeGlowTexture('rgba(255,170,80,1)');
  return sparkTex;
}

/** Pooled muzzle and impact flashes: eight point lights and eight billboards
 *  live in the scene and are recycled, so a long session never accumulates
 *  lights (which is what would start costing frames). Each flash lasts 60 ms. */
function makeFlashes(parent) {
  const lights = [];
  for (let i = 0; i < 8; i += 1) {
    const light = new THREE.PointLight(0xffc070, 0, 14, 2);
    light.visible = false;
    parent.add(light);
    lights.push({ light, t: 0 });
  }
  const sprites = [];
  for (let i = 0; i < 8; i += 1) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getFlashTex(), color: 0xffe0a0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    sp.visible = false;
    sp.renderOrder = 999;
    sp.userData = { t: 0 };
    parent.add(sp);
    sprites.push(sp);
  }

  function nextLight() {
    let best = lights[0];
    for (const l of lights) if (!l.light.visible || l.t < best.t) best = l;
    return best;
  }

  function nextSprite() {
    let best = sprites[0];
    for (const s of sprites) if (!s.visible || s.userData.t < best.userData.t) best = s;
    return best;
  }

  return {
    /** One gunshot's flash: a warm point light and a billboard at the muzzle. */
    muzzle(pos, scale) {
      const l = nextLight();
      l.t = 0.06;
      l.light.position.copy(pos);
      l.light.intensity = 9;
      l.light.color.setHex(0xffc070);
      l.light.visible = true;
      const sp = nextSprite();
      sp.position.copy(pos);
      sp.scale.setScalar(scale);
      sp.material.color.setHex(0xffe0a0);
      sp.material.opacity = 0.95;
      sp.visible = true;
      sp.userData.t = 0.06;
    },

    /** Slightly cooler puff where a round lands on Rook or the street. */
    impact(pos) {
      const l = nextLight();
      l.t = 0.05;
      l.light.position.copy(pos);
      l.light.intensity = 5;
      l.light.color.setHex(0xff9a50);
      l.light.visible = true;
      const sp = nextSprite();
      sp.position.copy(pos);
      sp.scale.setScalar(0.5);
      sp.material.color.setHex(0xffb070);
      sp.material.opacity = 0.7;
      sp.visible = true;
      sp.userData.t = 0.05;
    },

    update(dt) {
      for (const l of lights) {
        if (!l.light.visible) continue;
        l.t -= dt;
        if (l.t <= 0) { l.t = 0; l.light.visible = false; l.light.intensity = 0; }
      }
      for (const sp of sprites) {
        if (!sp.visible) continue;
        sp.userData.t -= dt;
        const k = Math.max(0, sp.userData.t / 0.06);
        sp.material.opacity = 0.95 * k;
        if (sp.userData.t <= 0) sp.visible = false;
      }
    },
  };
}

/** Shoot everything that shoots back. Combat doesn't own the camera: main.js
 *  passes it in each update so Rook can aim where he's looking. `enemies` is
 *  the enemies controller, `playerPos` the on-foot player (getPosition()). */
export function createCombat(scene, state, arsenal, enemies, playerPos, opts = {}) {
  const traffic = opts.traffic || null;
  const crosshair = opts.crosshair || null;
  const onKill = opts.onKill || null;
  const onDown = opts.onDown || null;
  const onHurt = opts.onHurt || null;

  // Flashes and tracer bolts live in their own group: one tidy parent, and a
  // marker so a raycast can skip them without ever walking it.
  const fxGroup = new THREE.Group();
  fxGroup.name = 'combat-fx';
  fxGroup.userData = { ignore: true };
  scene.add(fxGroup);
  const flashes = makeFlashes(fxGroup);
  const ray = new THREE.Raycaster();
  const tmpNdc = new THREE.Vector2();
  const tmpVec = new THREE.Vector3();
  const fwd = new THREE.Vector3();

  // Tracer bolts: a small pool of fading lines from the gun to the impact.
  const tracers = [];
  for (let i = 0; i < 10; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffd18a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    line.visible = false;
    line.userData = { t: 0 };
    fxGroup.add(line);
    tracers.push(line);
  }

  let aimYaw = 0;
  let aimPitch = 0;
  let armSwing = 0;
  let hurtFlash = 0;
  let meleeLast = 0;
  let wobble = 0;

  function playerPoint() {
    const p = playerPos.getPosition();
    p.y = 0;
    return p;
  }

  /** Chest: where an enemy round has to land to hurt him. */
  function chestPoint() {
    const p = playerPoint();
    p.y = MUZZLE_Y;
    return p;
  }

  /** Add a tracer from `from` toward `to`; it burns out in a beat. */
  function addTracer(from, to) {
    let line = null;
    for (const tr of tracers) if (!tr.visible) { line = tr; break; }
    if (!line) line = tracers[0];
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    line.visible = true;
    line.userData.t = 0.09;
    line.material.opacity = 0.95;
  }

  /** Damage Rook takes. Armour absorbs 60% of a round until it's spent. */
  function hurt(amount) {
    const rounds = Math.max(0, amount);
    let rest = rounds;
    if (state.armour > 0) {
      const soaked = Math.min(state.armour, rounds * ARMOUR_SOAK);
      state.armour = Math.max(0, state.armour - soaked);
      rest -= soaked;
    }
    state.health = Math.max(0, state.health - rest);
    hurtFlash = 1;
    if (onHurt) onHurt(rounds);
    if (state.health <= 0 && !state.down) {
      state.down = true;
      state.health = 0;
      if (onDown) onDown();
    }
  }

  /** Aim heading: camera forward when nothing is under the pointer; otherwise
   *  the direction from Rook to the ground spot the pointer is over. Hip-fire
   *  aim, so it snaps between headings rather than tracking a crosshair in 2D. */
  function aimHeading(cameraIn, mouseX, mouseY) {
    cameraIn.getWorldDirection(fwd);
    const fallback = Math.atan2(fwd.x, fwd.z);
    if (mouseX === undefined || mouseY === undefined) return fallback;
    tmpNdc.set((mouseX / window.innerWidth) * 2 - 1, -(mouseY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(tmpNdc, cameraIn);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    if (d.y > -1e-4) return fallback;
    const t = -0.6 / d.y;
    if (t < 0) return fallback;
    const p = playerPoint();
    const hx = o.x + d.x * t;
    const hz = o.z + d.z * t;
    if (Math.hypot(hx - p.x, hz - p.z) < 2) return fallback;
    return Math.atan2(hx - p.x, hz - p.z);
  }

  /** Muzzle world position: chest height, a hand's width to Rook's right
   *  along the aim, just ahead of him so the flash clears his jacket. */
  function muzzlePoint() {
    const p = playerPoint();
    const fx = -Math.sin(aimYaw);
    const fz = -Math.cos(aimYaw);
    p.x += fx * MUZZLE_FWD + fz * MUZZLE_SIDE;
    p.z += fz * MUZZLE_FWD - fx * MUZZLE_SIDE;
    p.y = MUZZLE_Y;
    return p;
  }

  /** Which entity a raycast leaf belongs to: an enemy, a pedestrian, a car. */
  function ownerOf(obj) {
    for (const e of enemies.list) {
      if (!e.alive) continue;
      if (e.fig === obj || e.fig.getObjectById(obj.id) === obj) return { enemy: e };
    }
    if (traffic) {
      for (const ped of traffic.peds) {
        if (ped.mesh === obj || ped.mesh.getObjectById(obj.id) === obj) return { ped };
      }
    }
    return null;
  }

  /** A fist swing straight ahead: the closest enemy within reach, inside the
   *  swing arc in front of Rook, takes it. */
  function meleeSwing() {
    const p = playerPoint();
    armSwing = 0.35;
    const aheadX = -Math.sin(aimYaw);
    const aheadZ = -Math.cos(aimYaw);
    const px = p.x + aheadX * MELEE_REACH;
    const pz = p.z + aheadZ * MELEE_REACH;
    let hit = null;
    let bestD = MELEE_REACH;
    const cosArc = Math.cos(MELEE_ARC);
    for (const e of enemies.list) {
      if (!e.alive || !e.mesh.visible) continue;
      const ex = e.pos.x - p.x;
      const ez = e.pos.z - p.z;
      const d = Math.hypot(ex, ez);
      if (d > MELEE_REACH) continue;
      // The enemy must sit inside the forward arc, not behind Rook.
      if (ex * aheadX + ez * aheadZ < d * cosArc) continue;
      if (d < bestD) { bestD = d; hit = e; }
    }
    if (hit) {
      const dmg = arsenal.current.damage;
      enemies.damage(hit, dmg, hit.pos.clone());
      if (onKill) onKill(hit, bestD);
    }
  }

  /** Fire one round from the gun along the camera-through-crosshair ray. */
  function fireRanged(shot, camera, mouseX, mouseY) {
    const muzzle = muzzlePoint();
    tmpNdc.set((mouseX / window.innerWidth) * 2 - 1, -(mouseY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(tmpNdc, camera);
    const dir = ray.ray.direction;
    const sp = shot.spread;
    dir.x += (Math.random() - 0.5) * sp * 2;
    dir.y += (Math.random() - 0.5) * sp * 2;
    dir.z += (Math.random() - 0.5) * sp * 2;
    dir.normalize();
    if (shot.muzzle) flashes.muzzle(muzzle, 1.2 + shot.knock * 2);
    aimPitch += (Math.random() - 0.5) * 0.006;

    const targets = [];
    for (const e of enemies.list) {
      if (e.alive && e.mesh.visible) targets.push(e.fig);
    }
    if (traffic) {
      for (const tc of traffic.cars) if (tc.visible && tc.mesh) targets.push(tc.mesh);
      for (const ped of traffic.peds) if (ped.mesh && ped.mesh.visible) targets.push(ped.mesh);
    }

    ray.far = shot.weapon.range;
    const hits = ray.intersectObjects(targets, true);
    if (hits.length > 0) {
      const h = hits[0];
      const pt = h.point;
      const owner = ownerOf(h.object);
      if (owner && owner.enemy) {
        const dmg = shot.damage;
        enemies.damage(owner.enemy, dmg, pt.clone());
        flashes.impact(pt);
        addTracer(muzzle, pt.clone());
        if (onKill) onKill(owner.enemy, h.distance);
      } else if (owner && owner.ped) {
        state.addStars(1);
        flashes.impact(pt);
        addTracer(muzzle, pt.clone());
      } else {
        flashes.impact(pt);
        addTracer(muzzle, pt.clone());
      }
    } else {
      const end = new THREE.Vector3().copy(muzzle).addScaledVector(dir, Math.min(shot.weapon.range, 30));
      addTracer(muzzle, end);
    }
    return { hit: hits.length > 0 };
  }

  /** Did an enemy round come near Rook's chest point this step? */
  function hitTest(shot, cp) {
    const ox = shot.origin.x, oz = shot.origin.z;
    const dx = shot.dir.x, dz = shot.dir.z;
    const vx = cp.x - ox, vz = cp.z - oz;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1e-6) return Math.hypot(vx, vz) < 0.9;
    const t = (vx * dx + vz * dz) / d2;
    if (t < 0 || t > 1.6) return false;
    const cx = ox + dx * t;
    const cz = oz + dz * t;
    return Math.hypot(cp.x - cx, cp.z - cz) < 0.9;
  }

  /** Advance a fixed step of the fight: weapons, flashes, firing, enemy shots,
   *  reload and crosshair. `input` is the shared input controller. */
  function update(dt, input, camera) {
    arsenal.update(dt);
    flashes.update(dt);
    for (const tr of tracers) {
      if (!tr.visible) continue;
      tr.userData.t -= dt;
      if (tr.userData.t <= 0) { tr.visible = false; tr.material.opacity = 0; }
    }
    if (hurtFlash > 0) hurtFlash = Math.max(0, hurtFlash - dt * 3);
    if (armSwing > 0) armSwing = Math.max(0, armSwing - dt * 6);

    const snap = input.snapshot();
    const wantIdx = snap.weapon - 1;
    if (arsenal.index !== snap.weapon) arsenal.select(wantIdx);
    const cur = arsenal.current;
    const onFootFire = !state.inCar && !state.down;

    aimYaw = aimHeading(camera, snap.mouseX, snap.mouseY);
    if (crosshair) {
      crosshair.style.display = (onFootFire && cur && !cur.melee) ? 'block' : 'none';
    }

    if (onFootFire) {
      const wantFire = cur && !cur.melee
        ? (cur.auto ? snap.mouseDown : input.click())
        : input.click();
      if (wantFire) {
        if (cur && cur.melee) meleeSwing();
        else if (cur) {
          const shot = arsenal.tryFire();
          if (shot) fireRanged(shot, camera, snap.mouseX, snap.mouseY);
        }
      }
    }

    if (input.pressedAny(['KeyR'])) arsenal.reload();

    const shots = enemies.update(dt, playerPos, !!state.inCar || !!state.down);
    if (!state.down) {
      const cp = chestPoint();
      for (const s of shots) if (hitTest(s, cp)) hurt(s.damage);
    }

    return { hurt: hurtFlash, arm: armSwing };
  }

  return {
    update,
    get aimYaw() { return aimYaw; },
    get hurt() { return hurtFlash; },
    get aiming() { return !!(arsenal.current && !arsenal.current.melee); },
  };
}