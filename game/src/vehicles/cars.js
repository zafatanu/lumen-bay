// LUMEN BAY car catalogue and low-poly car builder.
// Eight original cars, each a compact THREE.Group: body box, cabin box,
// four cylinder wheels, dark window boxes and emissive headlights.
// The catalog is shared by the parked starter car, traffic and car stealing.
import * as THREE from 'three';
import { buildPlayerMesh } from '../player/onfoot.js';

/** The eight original Lumen Bay cars. */
export const CARS = [
  { name: 'Coral Cruiser', topSpeed: 40, accel: 24, handling: 1.7, colour: 0xff8f6b, price: 26000 },
  { name: 'Bay Runner',    topSpeed: 46, accel: 27, handling: 1.9, colour: 0x2f7fd2, price: 18500 },
  { name: 'Neon Comet',    topSpeed: 62, accel: 34, handling: 2.3, colour: 0x7ad0ff, price: 98000 },
  { name: 'Dockside Hauler', topSpeed: 44, accel: 26, handling: 1.6, colour: 0xd2a23b, price: 34000 },
  { name: 'Marina Glide',  topSpeed: 56, accel: 30, handling: 2.1, colour: 0xe8e8ea, price: 112000 },
  { name: 'Sunset Taxi',   topSpeed: 46, accel: 27, handling: 1.9, colour: 0xffc21f, price: 15000 },
  { name: 'Gull Wing',     topSpeed: 50, accel: 33, handling: 1.5, colour: 0x6b2f8f, price: 46000 },
  { name: 'Palm Van',      topSpeed: 38, accel: 22, handling: 1.5, colour: 0x3c8f4f, price: 22000 },
];

const GEOMETRY = {
  body: new THREE.BoxGeometry(1, 1, 1),
  wheel: new THREE.CylinderGeometry(1, 1, 1, 10),
  wheelRing: new THREE.TorusGeometry(0.13, 0.022, 6, 12),
};

/** Emissive windshield glass so cars read at dusk. */
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0c1622, roughness: 0.15, metalness: 0.6 });

/** See-through canopy glass for cars carrying a visible driver: the same
 *  dusk tint, but transparent (and no depth write) so the seated figure
 *  reads inside instead of hiding behind a painted box. */
const canopyMat = new THREE.MeshStandardMaterial({
  color: 0x0c1622, roughness: 0.15, metalness: 0.6,
  transparent: true, opacity: 0.5, depthWrite: false,
});

function bodyMat(colour) {
  return new THREE.MeshStandardMaterial({ color: colour, roughness: 0.4, metalness: 0.45 });
}

/** Build a low-poly car mesh from a catalog definition.
 *  Returns a THREE.Group positioned at the origin, oriented +Z forward,
 *  with `.userData.def` set to the catalog entry and `.userData.body` holding
 *  the wheel collider radius for physics. `opts.driver` adds a seated
 *  driver figure under a glass canopy — visual only: the collider, the
 *  car's extents and the driving physics are untouched. */
export function buildCarMesh(def, opts = {}) {
  const group = new THREE.Group();
  const paint = bodyMat(def.colour);
  const withDriver = !!opts.driver;

  const body = new THREE.Mesh(GEOMETRY.body, paint);
  body.scale.set(1.9, 0.62, 4.1);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);

  // Tapered hood: a thin painted wedge sloping down toward the nose, so the
  // front end reads as a slope instead of a second stacked box.
  const hood = new THREE.Mesh(GEOMETRY.body, paint);
  hood.scale.set(1.72, 0.16, 1.35);
  hood.position.set(0, 0.96, 1.3);
  hood.rotation.x = 0.14;
  hood.castShadow = true;
  group.add(hood);

  // Cabin: a smaller box on top. The convertible sits lower with no top box.
  // With a driver aboard the closed cabin becomes a glass canopy so the
  // figure is visible; the convertible keeps its painted low sides (the
  // driver's head reads above them, open-top style).
  const isConvertible = def.name === 'Coral Cruiser';
  const glassCab = withDriver && !isConvertible;
  const cab = new THREE.Mesh(GEOMETRY.body, glassCab ? canopyMat : paint);
  const cabH = isConvertible ? 0.42 : 0.62;
  cab.scale.set(1.5, cabH, 2.0);
  cab.position.set(0, body.position.y + 0.42, -0.2);
  cab.castShadow = !glassCab;
  group.add(cab);

  // Windows: dark glass boxes inset into the cabin sides and rear. A driver
  // car skips them — the opaque strips would hide the figure behind the
  // canopy; the tinted canopy itself reads as the glazing.
  const winH = isConvertible ? 0.2 : 0.34;
  if (!withDriver) {
    for (const [dx, dz, w, d] of [
      [0, -0.6, 0.2, 1.0], // rear
      [0.78, -0.2, 0.18, 1.7], // left
      [-0.78, -0.2, 0.18, 1.7], // right
    ]) {
      const win = new THREE.Mesh(GEOMETRY.body, glassMat);
      win.scale.set(w, winH, d);
      win.position.set(dx, body.position.y + 0.42 + winH / 2, dz);
      group.add(win);
    }
  }

  // Windshield: a glass plane leaned back over the hood instead of a flat
  // front window box, so the cabin front reads as a rake, not a slab.
  const shield = new THREE.Mesh(GEOMETRY.body, withDriver ? canopyMat : glassMat);
  shield.scale.set(1.42, cabH + 0.05, 0.06);
  shield.position.set(0, body.position.y + 0.42 + cabH / 2 - 0.02, 0.86);
  shield.rotation.x = -0.42;
  group.add(shield);

  // Wheels: four dark cylinders, radius 0.34, each on its own axle group so
  // the driving code can roll it around its local X (the axle) and steer the
  // front pair around Y without moving the contact patch off the road.
  const wheelGeo = GEOMETRY.wheel;
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.9, metalness: 0.1 });
  const wR = 0.34;
  const wHalf = 0.16;
  // Wheel wells: dark arch panels flush with the body sides so the wheels
  // sit in shadowed openings instead of floating beside a plain slab.
  for (const [x, z] of [[0.97, 1.25], [-0.97, 1.25], [0.97, -1.25], [-0.97, -1.25]]) {
    const well = new THREE.Mesh(GEOMETRY.body, tyreMat);
    well.scale.set(0.16, 0.6, 1.05);
    well.position.set(x, 0.56, z);
    group.add(well);
  }
  for (const [x, z] of [[1.05, 1.25], [-1.05, 1.25], [1.05, -1.25], [-1.05, -1.25]]) {
    const axle = new THREE.Group();
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    // Circular disc of radius wR in the Y/Z plane, thin along the X axle.
    // (The baked Z-rotation below turns the cylinder's Y height into the axle.)
    w.scale.set(wR, 0.22, wR);
    w.rotation.z = Math.PI / 2;
    axle.add(w);
    axle.position.set(x, wR, z);
    axle.userData.wheel = true;
    group.add(axle);
  }

  // Headlight bar: one full-width warm emissive strip at the front. The
  // emissive glow makes every car visible against the dusk skyline, so
  // traffic pops in the chase shot without any extra lighting work.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd9a0, emissiveIntensity: 1.4 });
  const head = new THREE.Mesh(GEOMETRY.body, lightMat);
  head.scale.set(1.5, 0.1, 0.12);
  head.position.set(0, 0.74, 2.06);
  group.add(head);

  // Tail light bar: one red emissive strip across the back.
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2f2f, emissive: 0xff2f2f, emissiveIntensity: 0.8 });
  const tail = new THREE.Mesh(GEOMETRY.body, tailMat);
  tail.scale.set(1.6, 0.1, 0.12);
  tail.position.set(0, 0.66, -2.06);
  group.add(tail);

  // Seated driver: Rook's own torso/head/arms rig (buildPlayerMesh) posed
  // at the wheel — thighs forward under the dash, hands out to the rim,
  // slight seat recline. Scaled to fit under the roofline and parked on the
  // right-side seat (Lumen Bay drives on the left). Purely visual: it sits
  // inside the existing cabin volume, so the collider (userData.body below),
  // the car's extents and the driving physics never change.
  if (withDriver) {
    const fig = buildPlayerMesh();
    const limbs = fig.userData.limbs;
    limbs.legL.rotation.x = -Math.PI / 2;   // thighs forward, hidden in the body
    limbs.legR.rotation.x = -Math.PI / 2;
    limbs.armL.rotation.set(-1.35, 0, -0.3); // hands forward and inward to the wheel
    limbs.armR.rotation.set(-1.35, 0, 0.3);
    limbs.body.rotation.x = -0.12;           // slight seat recline
    fig.scale.setScalar(0.52);
    fig.position.set(-0.35, 0.37, -0.25);
    group.add(fig);
    // Steering wheel: one thin torus the hands reach, tilted toward the seat.
    const wheel = new THREE.Mesh(GEOMETRY.wheelRing, tyreMat);
    wheel.position.set(-0.35, 0.99, 0.12);
    wheel.rotation.x = -0.35;
    group.add(wheel);
    group.userData.driver = fig;
  }

  // A wheel radius the driving physics uses for the circle collider.
  group.userData.def = def;
  group.userData.body = { r: wHalf + 0.1, length: 4.3 };
  return group;
}

// Shared soft radial glow texture (white core fading to transparent). Built
// once on first use; the tire smoke (normal blending), police lightbar glow
// and GULLWATCH spotlight pool (additive) all reuse it, so no effect pays for
// its own canvas. The gradient is alpha-only, so it reads the same under any
// blending mode or tint colour.
let glowTex = null;
export function makeGlowTexture() {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(cv);
  // White-core colour map: tag it sRGB like the other canvas textures so the
  // tint colours (lamp red/blue, smoke, spotlight pool) decode consistently.
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** Display name of a catalog entry or a built car mesh. */
export function carName(def) {
  if (!def) return '??';
  return def.name || def.userData?.def?.name || 'car';
}

/** Normalised performance stats (0..1) for the garage screen and HUD bars. */
export function carStats(def) {
  const t = { name: 'car', topSpeed: 40, accel: 24, handling: 1.7 };
  const d = { ...t, ...(def || {}) };
  return {
    topSpeed: d.topSpeed / 70,
    accel: d.accel / 40,
    handling: d.handling / 2.5,
  };
}