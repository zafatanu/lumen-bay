// LUMEN BAY on-foot player: Rook, the getaway driver, plus the third-person
// follow camera and building collision for walking. The player stays on the
// road grid; stepping outside a block is clamped so Rook never clips a building.
import * as THREE from 'three';
import { WORLD, PLAYER } from '../config.js';
import { buildGunMesh } from '../combat/weapons.js';
import { limb, swingWalk, STRIDE } from '../figure.js';

function roadLine(i) {
  const west = -WORLD.total / 2;
  return west + i * (WORLD.block + WORLD.road);
}

function nearestRoad(v) {
  let best = Infinity;
  let bestI = 0;
  for (let i = 0; i <= WORLD.blocks; i += 1) {
    const r = roadLine(i);
    const d = v - r;
    if (Math.abs(d) < Math.abs(best)) { best = d; bestI = i; }
  }
  return { line: roadLine(bestI), d: best };
}

/** Keep the player out of building blocks: slide back toward the road edge. */
function clampToRoads(pos, r) {
  const nx = nearestRoad(pos.x);
  const nz = nearestRoad(pos.z);
  if (Math.abs(nx.d) <= WORLD.road / 2 - r) return;
  if (Math.abs(nz.d) <= WORLD.road / 2 - r) return;
  const xPush = Math.abs(nx.d) - (WORLD.road / 2 - r);
  const zPush = Math.abs(nz.d) - (WORLD.road / 2 - r);
  if (xPush <= zPush) pos.x = nx.line + Math.sign(nx.d) * (WORLD.road / 2 - r);
  else pos.z = nz.line + Math.sign(nz.d) * (WORLD.road / 2 - r);
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
  // Merge overlapping spans; the merged span covering t=0 (the player is
  // always on a road) ends where the segment first leaves the road union.
  let end = spans[0][1];
  for (let i = 1; i < spans.length; i += 1) {
    if (spans[i][0] > end) break;
    end = Math.max(end, spans[i][1]);
  }
  return Math.min(1, end);
}

/** Build Rook: teal jacket, dark jeans, cap. Returns a THREE.Group whose
 *  legs/arms hang from hip/shoulder pivots and whose head sits on a neck
 *  pivot (userData.limbs), so the walk cycle can swing them — the same rig
 *  the pedestrians use in vehicles/traffic.js. Rest pose is unchanged. */
export function buildPlayerMesh() {
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0x1fb9a8, roughness: 0.7 });
  const jeans = new THREE.MeshStandardMaterial({ color: 0x262c33, roughness: 0.9 });
  const cap = new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a87c, roughness: 0.85 });

  // Legs on hip pivots: the cylinder hangs below the pivot, so rotation.x
  // swings the whole leg about the hip (rest: feet on the ground at y=0).
  const legGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.72, 6);
  const legL = limb(group, 0.16, 0.72, legGeo, jeans, 0.72);
  const legR = limb(group, -0.16, 0.72, legGeo, jeans, 0.72);
  // Body: teal jacket, taller to read as a driver's coat.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.72, 8), jacket);
  body.position.y = 0.98;
  group.add(body);
  // Arms on shoulder pivots, hanging to the same rest height as before.
  const armGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 5);
  const armL = limb(group, 0.4, 1.45, armGeo, jacket, 0.7);
  const armR = limb(group, -0.4, 1.45, armGeo, jacket, 0.7);
  // Head on a neck pivot: skull + cap + brim bob together with the steps.
  const head = new THREE.Group();
  head.position.y = 1.62;
  head.userData.baseY = 1.62;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), skin);
  head.add(skull);
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 8), cap);
  capTop.position.y = 0.2;
  head.add(capTop);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.26), cap);
  brim.position.set(0, 0.16, 0.16);
  head.add(brim);
  // Slightly larger head so Rook reads as a man at human scale, not a peg.
  head.scale.multiplyScalar(1.1);
  group.add(head);
  group.userData.limbs = { legL, legR, armL, armR, head, body };
  // Rook stands 1.75-1.8 units (1 unit = 1m): the rig builds ~1.9 tall, so
  // shrink the whole figure uniformly to land at ~1.79m. Visual only — the
  // walk cycle, seated-driver pose and collision radius are unaffected.
  group.scale.multiplyScalar(0.94);
  return group;
  return group;
}

/** Third-person follow camera behind Rook, smoothed so it lags on turns.
 *  `colliders` (city.colliders, optional) enables occlusion pull-in so the
 *  camera never swings into a building block. */
export function followCamera(camera, dt, pos, heading, colliders) {
  // On-foot follow: measured hero frame-height at back=4.5/up=2.25 was ~45%
  // (too large) and at back=7.5 ~28% (still over). Pull back to ~9m and 2.5m
  // up so Rook lands ~22-24% of frame height at FOV 55 — the GTA-style bar.
  const back = 9.0;
  const up = 2.5;
  let cx = pos.x - Math.sin(heading) * back;
  let cz = pos.z - Math.cos(heading) * back;
  let cy = pos.y + up;
  // Occlusion: cast from Rook's head to the desired camera spot against the
  // road-strip AABBs; where the segment leaves the road union, pull the
  // target in to hit distance minus a margin. Only ever shortens the
  // distance — the lerp smoothing below is unchanged.
  if (colliders && colliders.length) {
    const hx = pos.x, hy = pos.y + 1.6, hz = pos.z;
    const t = roadUnionExit(colliders, hx, hz, cx, cz);
    if (t < 1) {
      const dx = cx - hx, dz = cz - hz;
      const len = Math.hypot(dx, dz);
      // Margin covers the 0.5 near plane; the 1.0 floor keeps the camera
      // out of Rook's own mesh when he stands at a road edge (the building
      // faces sit 5.4m inside the block edge, so this stays clear of them).
      const allow = len > 1e-6 ? Math.min(len, Math.max(1.0, t * len - 0.6)) / len : 0;
      cx = hx + dx * allow;
      cz = hz + dz * allow;
      cy = hy + (cy - hy) * allow;
    }
  }
  const k = Math.min(1, dt * 8);
  camera.position.x += (cx - camera.position.x) * k;
  camera.position.y += (cy - camera.position.y) * k;
  camera.position.z += (cz - camera.position.z) * k;
  if (camera.position.y < 0.5) camera.position.y = 0.5;
  // Ease the look point as well as the position so a quick turn swings the
  // view instead of whipping it. The target is unchanged (Rook's chest).
  const tx = pos.x, ty = pos.y + 1.0, tz = pos.z;
  let look = camera.userData.followLook;
  if (!look) { look = new THREE.Vector3(tx, ty, tz); camera.userData.followLook = look; }
  const dx = tx - look.x, dy = ty - look.y, dz = tz - look.z;
  if (dx * dx + dy * dy + dz * dz > 144) look.set(tx, ty, tz);  // teleport: snap, don't sweep
  const lk = Math.min(1, dt * 10);
  look.x += (tx - look.x) * lk;
  look.y += (ty - look.y) * lk;
  look.z += (tz - look.z) * lk;
  camera.lookAt(look.x, look.y, look.z);
  const fovTarget = 55;   // audit FOV sweep: 50->24%, 55->22%, 60->20%; 55 chosen
  camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}

/** On-foot controller: WASD relative to camera yaw, Shift sprint. */
export function createOnFoot(state, city, scene) {
  const mesh = buildPlayerMesh();
  scene.add(mesh);
  const pos = new THREE.Vector3();
  let heading = 0;
  // The gun lives in the right hand; it is rebuilt only when the weapon changes.
  let gun = null;
  let gunFor = null;
  const GUN_AT = { x: 0.42, y: 1.05, z: 0.22 };

  // --- Visual-only character feel (mesh transforms, never movement or
  // collision): the body eases to its heading, banks into turns, leans into
  // acceleration, kicks back on a shot and reels when a round lands. None of
  // this feeds back into pos, heading, speed or hit detection.
  let visHeading = 0;      // mesh yaw, eases toward the logical heading
  let prevVisHeading = 0;  // last mesh yaw, for the turn-rate bank
  let leanPitch = 0;       // eased forward/back lean (speed + acceleration)
  let leanRoll = 0;        // eased bank into turns
  let recoil = 0;          // 1 on a shot, decays fast (torso + gun kick)
  let flinch = 0;          // 1 when hit, decays (reel back + twist)
  let prevMoveSpeed = 0;   // commanded speed last step, for the accel lean
  let walkPhase = 0;       // gait angle, advanced by distance travelled
  let walkAmp = 0;         // eased 0..1 gait amount; 0 settles limbs to neutral
  let lastMag = null;      // magazine last step: a drop means a shot fired
  let lastHealth = null;   // health/armour last step: a drop means a hit
  let lastArmour = null;
  /** Current magazine for a weapon id, or null when there isn't one. */
  function magOf(id) {
    const a = state.ammo && id && state.ammo[id];
    return a ? a.mag : null;
  }

  function setWeapon(id) {
    if (id === gunFor) return;
    gunFor = id;
    lastMag = magOf(id);   // a weapon switch is not a shot
    if (gun) { mesh.remove(gun); gun = null; }
    if (id && id !== 'fists') {
      gun = buildGunMesh(id);
      gun.position.set(GUN_AT.x, GUN_AT.y, GUN_AT.z);
      gun.visible = true;
      mesh.add(gun);
    }
  }

  function setPosition(p, h) {
    pos.copy(p); pos.y = 0;
    heading = h !== undefined ? h : heading;
    mesh.position.copy(pos);
    // Sync the visual layer so a teleport doesn't spin or replay old hits.
    visHeading = heading;
    prevVisHeading = heading;
    leanPitch = leanRoll = recoil = flinch = 0;
    prevMoveSpeed = 0;
    walkPhase = 0;
    walkAmp = 0;
    swingWalk(mesh.userData.limbs, 0, 0);   // teleport lands in neutral, not mid-stride
    lastMag = magOf(gunFor);
    lastHealth = state.health;
    lastArmour = state.armour;
    mesh.rotation.set(0, heading, 0);
    if (gun) gun.rotation.x = 0;
  }

  function getPosition() { return pos.clone(); }

  function hide() { mesh.visible = false; }
  function show() {
    mesh.visible = true;
    // Back on foot (car exit / respawn): refresh the hit baseline so damage
    // taken while driving isn't replayed as a flinch now.
    lastHealth = state.health;
    lastArmour = state.armour;
  }

  function update(dt, input, camera, aimHeading, aiming) {
    // Camera yaw from its forward direction on the XZ plane.
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const yaw = Math.atan2(dir.x, dir.z);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Screen-left of the camera forward: right is cross(forward, up) =
    // (-fz, fx), so left is its negation (fz, -fx).
    const rx = fz;
    const rz = -fx;

    let mx = 0, mz = 0;
    if (input.up) { mx += fx; mz += fz; }
    if (input.down) { mx -= fx; mz -= fz; }
    if (input.left) { mx += rx; mz += rz; }
    if (input.right) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    if (len > 0.001) {
      mx /= len; mz /= len;
      heading = Math.atan2(mx, mz);
    } else if (aiming && typeof aimHeading === 'number') {
      // Braced on the trigger: Rook faces where he's pointing, not where he's
      // walking (he isn't walking) — this keeps the gun aimed at the crosshair.
      // Ease toward the aim so the gun swings smoothly instead of teleporting.
      let d = aimHeading - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      heading += d * Math.min(1, dt * 12);
    }
    const speed = input.sprint ? PLAYER.run : PLAYER.walk;
    pos.x += mx * speed * dt;
    pos.z += mz * speed * dt;
    clampToRoads(pos, 0.3);
    mesh.position.copy(pos);

    // --- Read-only combat cues: a shot drops the magazine by one and a landed
    // round drops health or armour. Observing those drops triggers the pose;
    // ammo, damage and hit detection themselves are never touched here.
    const mag = magOf(gunFor);
    if (mag !== null && lastMag !== null && mag < lastMag) recoil = 1;
    lastMag = mag;
    const hp = state.health, ar = state.armour;
    if (lastHealth !== null && (hp < lastHealth || ar < lastArmour)) flinch = 1;
    lastHealth = hp; lastArmour = ar;

    // --- Visual feel only: mesh transforms below never feed back into pos,
    // heading, speed or collision.
    const vdt = Math.min(dt, 0.05);   // keep the eases stable on lag spikes
    // Facing eases toward the logical heading instead of snapping to it.
    let dh = heading - visHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    visHeading += dh * Math.min(1, vdt * 10);
    // Bank into the turn from the eased facing rate.
    let turn = visHeading - prevVisHeading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    prevVisHeading = visHeading;
    const rollT = THREE.MathUtils.clamp(-(turn / Math.max(vdt, 1e-4)) * 0.045, -0.16, 0.16);
    leanRoll += (rollT - leanRoll) * Math.min(1, vdt * 8);
    // Lean into acceleration and into the run itself.
    const moveSpeed = len > 0.001 ? speed : 0;
    const accel = (moveSpeed - prevMoveSpeed) / Math.max(vdt, 1e-4);
    prevMoveSpeed = moveSpeed;
    const pitchT = THREE.MathUtils.clamp(moveSpeed * 0.010 + accel * 0.010, -0.16, 0.20);
    leanPitch += (pitchT - leanPitch) * Math.min(1, vdt * 7);
    // Decay the shot kick and the hit reel, then compose the pose.
    recoil = Math.max(0, recoil - vdt * 8);
    flinch = Math.max(0, flinch - vdt * 5);
    const pitch = leanPitch - recoil * 0.12 - flinch * 0.20;
    const roll = leanRoll + flinch * 0.13;
    mesh.rotation.set(pitch, visHeading, roll);
    if (gun) gun.rotation.x = -recoil * 0.30;   // muzzle flips up on the shot
    // Walk/run cycle: the phase advances with distance travelled (moveSpeed
    // * dt), and the gait amount eases in/out so idle limbs settle back to
    // neutral instead of freezing mid-stride. Composes with the whole-mesh
    // lean/bank/recoil above (the gun stays parented to the root, so its
    // recoil is untouched) — it never touches pos, heading or collision.
    walkPhase += moveSpeed * vdt * STRIDE;
    if (walkPhase > Math.PI * 2) walkPhase -= Math.PI * 2;
    const gaitT = moveSpeed > 0.01 ? 1 : 0;
    walkAmp += (gaitT - walkAmp) * Math.min(1, vdt * 8);
    swingWalk(mesh.userData.limbs, walkPhase, walkAmp);
  }

  return { mesh, update, setWeapon, setPosition, getPosition, hide, show, get heading() { return heading; } };
}