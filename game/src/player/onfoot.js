// LUMEN BAY on-foot player: Rook, the getaway driver, plus the third-person
// follow camera and building collision for walking. The player stays on the
// road grid; stepping outside a block is clamped so Rook never clips a building.
import * as THREE from 'three';
import { WORLD, PLAYER } from '../config.js';
import { buildGunMesh } from '../combat/weapons.js';

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

/** Build Rook: teal jacket, dark jeans, cap. Returns a THREE.Group. */
export function buildPlayerMesh() {
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0x1fb9a8, roughness: 0.7 });
  const jeans = new THREE.MeshStandardMaterial({ color: 0x262c33, roughness: 0.9 });
  const cap = new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a87c, roughness: 0.85 });

  // Legs.
  const legGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.72, 6);
  for (const lx of [0.16, -0.16]) {
    const leg = new THREE.Mesh(legGeo, jeans);
    leg.position.set(lx, 0.36, 0);
    group.add(leg);
  }
  // Body: teal jacket, taller to read as a driver's coat.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.72, 8), jacket);
  body.position.y = 0.98;
  group.add(body);
  // Arms.
  const armGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 5);
  for (const ax of [0.4, -0.4]) {
    const arm = new THREE.Mesh(armGeo, jacket);
    arm.position.set(ax, 1.1, 0);
    group.add(arm);
  }
  // Head.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), skin);
  head.position.y = 1.62;
  group.add(head);
  // Cap: a flat box + a small brim.
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 8), cap);
  capTop.position.y = 1.82;
  group.add(capTop);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.26), cap);
  brim.position.set(0, 1.78, 0.16);
  group.add(brim);
  return group;
}

/** Third-person follow camera behind Rook, smoothed so it lags on turns. */
export function followCamera(camera, dt, pos, heading) {
  const back = 3.4;
  const up = 3.1;
  const cx = pos.x - Math.sin(heading) * back;
  const cz = pos.z - Math.cos(heading) * back;
  const k = Math.min(1, dt * 8);
  camera.position.x += (cx - camera.position.x) * k;
  camera.position.y += (pos.y + up - camera.position.y) * k;
  camera.position.z += (cz - camera.position.z) * k;
  camera.lookAt(pos.x, pos.y + 1.0, pos.z);
  const fovTarget = 55;
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
  function setWeapon(id) {
    if (id === gunFor) return;
    gunFor = id;
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
    mesh.rotation.y = heading;
  }

  function getPosition() { return pos.clone(); }

  function hide() { mesh.visible = false; }
  function show() { mesh.visible = true; }

  function update(dt, input, camera, aimHeading, aiming) {
    // Camera yaw from its forward direction on the XZ plane.
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const yaw = Math.atan2(dir.x, dir.z);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;

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
    mesh.rotation.y = heading;
  }

  return { mesh, update, setWeapon, setPosition, getPosition, hide, show, get heading() { return heading; } };
}