// LUMEN BAY car catalogue and low-poly car builder.
// Eight original cars, each a compact THREE.Group: body box, cabin box,
// four cylinder wheels, dark window boxes and emissive headlights.
// Each entry carries a `body` variant ('wedge' | 'sedan' | 'van' | 'hauler'
// | 'taxi') that buildCarMesh reads to shape the silhouette; every variant
// also gets bumpers, mirrors, a grille and hubcaps.
// The catalog is shared by the parked starter car, traffic and car stealing.
import * as THREE from 'three';
import { buildPlayerMesh } from '../player/onfoot.js';

/** The eight original Lumen Bay cars. */
export const CARS = [
  { name: 'Coral Cruiser', body: 'sedan', topSpeed: 40, accel: 24, handling: 1.7, colour: 0xff8f6b, price: 26000 },
  { name: 'Bay Runner',    body: 'sedan', topSpeed: 46, accel: 27, handling: 1.9, colour: 0x2f7fd2, price: 18500 },
  { name: 'Neon Comet',    body: 'wedge', topSpeed: 62, accel: 34, handling: 2.3, colour: 0x7ad0ff, price: 98000 },
  { name: 'Dockside Hauler', body: 'hauler', topSpeed: 44, accel: 26, handling: 1.6, colour: 0xd2a23b, price: 34000 },
  { name: 'Marina Glide',  body: 'sedan', topSpeed: 56, accel: 30, handling: 2.1, colour: 0xe8e8ea, price: 112000 },
  { name: 'Sunset Taxi',   body: 'taxi', topSpeed: 46, accel: 27, handling: 1.9, colour: 0xffc21f, price: 15000 },
  { name: 'Gull Wing',     body: 'sedan', topSpeed: 50, accel: 33, handling: 1.5, colour: 0x6b2f8f, price: 46000 },
  { name: 'Palm Van',      body: 'van', topSpeed: 38, accel: 22, handling: 1.5, colour: 0x3c8f4f, price: 22000 },
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

// Shared dressing materials: dark trim (bumpers, grille, mirrors stalks,
// skirts, spoiler stalks, bed floor), light hubcap metal and the lit taxi
// roof sign. Module-level so no car pays its own allocation.
const trimMat = new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.85, metalness: 0.2 });
const capMat = new THREE.MeshStandardMaterial({ color: 0xd6dae2, roughness: 0.3, metalness: 0.8 });
const taxiSignMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffdf8a, emissiveIntensity: 1.3 });

/** Build a low-poly car mesh from a catalog definition.
 *  Returns a THREE.Group positioned at the origin, oriented +Z forward,
 *  with `.userData.def` set to the catalog entry and `.userData.body` holding
 *  the wheel collider radius for physics. The silhouette comes from the
 *  catalog's `body` variant ('wedge' | 'sedan' | 'van' | 'hauler' | 'taxi',
 *  default 'sedan') — never from a name check here. `opts.driver` adds a
 *  seated driver figure under a glass canopy — visual only: the collider,
 *  the car's extents and the driving physics are untouched. */
export function buildCarMesh(def, opts = {}) {
  const group = new THREE.Group();
  const paint = bodyMat(def.colour);
  const withDriver = !!opts.driver;
  const variant = def.body || 'sedan';
  const isWedge = variant === 'wedge';
  const isVan = variant === 'van';
  const isHauler = variant === 'hauler';
  const isTaxi = variant === 'taxi';

  // Body slab per variant: the wedge hero sits lower and longer than any
  // traffic car; the van is taller and boxier. Visual only — the collider
  // at the bottom of this function is the same for every variant.
  const bodyW = isVan ? 1.94 : 1.9;
  const bodyH = isWedge ? 0.5 : isVan ? 0.7 : 0.62;
  const bodyL = isWedge ? 4.5 : isVan ? 4.2 : 4.1;
  const bodyY = isWedge ? 0.5 : isVan ? 0.65 : 0.62;
  const frontZ = bodyL / 2;
  const body = new THREE.Mesh(GEOMETRY.body, paint);
  body.scale.set(bodyW, bodyH, bodyL);
  body.position.y = bodyY;
  body.castShadow = true;
  group.add(body);

  // Hood: a thin painted wedge sloping down toward the nose. The hero's is
  // longer and steeper (a true wedge nose reaching past the body); the van
  // and hauler get short hoods ahead of their tall cabin / pickup cab.
  const hood = new THREE.Mesh(GEOMETRY.body, paint);
  if (isWedge) {
    hood.scale.set(1.82, 0.12, 2.2);
    hood.position.set(0, 0.74, 1.5);
    hood.rotation.x = 0.22;
  } else if (isVan) {
    hood.scale.set(1.7, 0.14, 0.8);
    hood.position.set(0, 1.06, 1.72);
    hood.rotation.x = 0.1;
  } else if (isHauler) {
    hood.scale.set(1.72, 0.16, 0.85);
    hood.position.set(0, 0.96, 1.62);
    hood.rotation.x = 0.14;
  } else {
    hood.scale.set(1.72, 0.16, 1.35);
    hood.position.set(0, 0.96, 1.3);
    hood.rotation.x = 0.14;
  }
  hood.castShadow = true;
  group.add(hood);

  // Cabin: a smaller box on top. The convertible sits lower with no top box.
  // With a driver aboard the closed cabin becomes a glass canopy so the
  // figure is visible; the convertible keeps its painted low sides (the
  // driver's head reads above them, open-top style). The roofline height
  // (cabY) is a fixed absolute value, NOT derived from the variant body
  // height: the wedge body drops beneath the very same canopy, so the P4
  // seated driver keeps his exact fit. The van's tall boxy cabin and the
  // hauler's short cab (still covering the driver's seat) are the exceptions.
  const isConvertible = def.name === 'Coral Cruiser';
  const glassCab = withDriver && !isConvertible;
  const cab = new THREE.Mesh(GEOMETRY.body, glassCab ? canopyMat : paint);
  const cabH = isConvertible ? 0.42 : isVan ? 1.0 : 0.62;
  const cabW = isVan ? 1.78 : 1.5;
  const cabL = isVan ? 3.2 : isHauler ? 1.7 : 2.0;
  const cabZ = isVan ? -0.35 : isHauler ? 0.35 : -0.2;
  const cabY = isVan ? 1.42 : 1.04;
  cab.scale.set(cabW, cabH, cabL);
  cab.position.set(0, cabY, cabZ);
  cab.castShadow = !glassCab;
  group.add(cab);

  // Windows: dark glass boxes inset into the cabin sides and rear. A driver
  // car skips them — the opaque strips would hide the figure behind the
  // canopy; the tinted canopy itself reads as the glazing.
  const winH = isConvertible ? 0.2 : isVan ? 0.4 : 0.34;
  const winBaseY = isVan ? cabY + 0.18 : cabY;
  const winLayout = isVan
    ? [
      [0, -1.92, 1.5, 0.16], // rear
      [0.9, -0.35, 0.16, 2.6], // left
      [-0.9, -0.35, 0.16, 2.6], // right
    ]
    : isHauler
      ? [
        [0, -0.52, 0.2, 0.6], // cab rear
        [0.78, 0.35, 0.18, 1.4], // left
        [-0.78, 0.35, 0.18, 1.4], // right
      ]
      : [
        [0, -0.6, 0.2, 1.0], // rear
        [0.78, -0.2, 0.18, 1.7], // left
        [-0.78, -0.2, 0.18, 1.7], // right
      ];
  if (!withDriver) {
    for (const [dx, dz, w, d] of winLayout) {
      const win = new THREE.Mesh(GEOMETRY.body, glassMat);
      win.scale.set(w, winH, d);
      win.position.set(dx, winBaseY + winH / 2, dz);
      group.add(win);
    }
  }

  // Windshield: a glass plane leaned back over the hood instead of a flat
  // front window box, so the cabin front reads as a rake, not a slab. The
  // van's is taller and more upright, ahead of its boxy cabin.
  const shield = new THREE.Mesh(GEOMETRY.body, withDriver ? canopyMat : glassMat);
  if (isVan) {
    shield.scale.set(1.62, 0.8, 0.06);
    shield.position.set(0, cabY + 0.12, cabZ + cabL / 2 + 0.05);
    shield.rotation.x = -0.18;
  } else {
    shield.scale.set(1.42, cabH + 0.05, 0.06);
    shield.position.set(0, cabY + cabH / 2 - 0.02, cabZ + cabL / 2 + 0.06);
    shield.rotation.x = -0.42;
  }
  group.add(shield);

  // Wheels: four dark cylinders, radius 0.34, each on its own axle group so
  // the driving code can roll it around its local X (the axle) and steer the
  // front pair around Y without moving the contact patch off the road.
  const wheelGeo = GEOMETRY.wheel;
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.9, metalness: 0.1 });
  const wR = 0.34;
  const wHalf = 0.16;
  // Wheel wells: dark arch panels flush with the body sides so the wheels
  // sit in shadowed openings instead of floating beside a plain slab. The
  // wedge's wells drop with its lower body.
  const wellY = isWedge ? 0.5 : 0.56;
  const wellH = isWedge ? 0.5 : 0.6;
  for (const [x, z] of [[0.97, 1.25], [-0.97, 1.25], [0.97, -1.25], [-0.97, -1.25]]) {
    const well = new THREE.Mesh(GEOMETRY.body, tyreMat);
    well.scale.set(0.16, wellH, 1.05);
    well.position.set(x, wellY, z);
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
    // Hubcap: a lighter metal disc proud of the outer tyre face. It lives
    // inside the axle group so it rolls and steers with the wheel.
    const cap = new THREE.Mesh(wheelGeo, capMat);
    cap.scale.set(0.19, 0.25, 0.19);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = Math.sign(x) * 0.02;
    axle.add(cap);
    axle.position.set(x, wR, z);
    axle.userData.wheel = true;
    group.add(axle);
  }

  // Headlight bar: one full-width warm emissive strip at the front. The
  // emissive glow makes every car visible against the dusk skyline, so
  // traffic pops in the chase shot without any extra lighting work.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd9a0, emissiveIntensity: 1.4 });
  const head = new THREE.Mesh(GEOMETRY.body, lightMat);
  head.scale.set(bodyW - 0.4, 0.1, 0.12);
  head.position.set(0, isWedge ? 0.7 : isVan ? 0.78 : 0.74, frontZ + 0.01);
  group.add(head);

  // Tail light bar: one red emissive strip across the back.
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2f2f, emissive: 0xff2f2f, emissiveIntensity: 0.8 });
  const tail = new THREE.Mesh(GEOMETRY.body, tailMat);
  tail.scale.set(bodyW - 0.3, 0.1, 0.12);
  tail.position.set(0, isWedge ? 0.6 : isVan ? 0.72 : 0.66, -(frontZ + 0.01));
  group.add(tail);

  // Bumpers: thin dark bars front and rear, below the light bars.
  const bumperY = isWedge ? 0.34 : isVan ? 0.46 : 0.42;
  for (const sz of [1, -1]) {
    const bumper = new THREE.Mesh(GEOMETRY.body, trimMat);
    bumper.scale.set(bodyW + 0.06, 0.16, 0.14);
    bumper.position.set(0, bumperY, sz * (frontZ + 0.08));
    group.add(bumper);
  }

  // Grille: a dark inset panel on the front face between bumper and lights.
  const grille = new THREE.Mesh(GEOMETRY.body, trimMat);
  grille.scale.set(1.1, 0.16, 0.06);
  grille.position.set(0, isWedge ? 0.5 : isVan ? 0.62 : 0.58, frontZ + 0.02);
  group.add(grille);

  // Side mirrors: small painted heads on thin dark stalks at the cabin's
  // front corners, both sides.
  const mirrorZ = cabZ + cabL / 2 - 0.12;
  for (const side of [1, -1]) {
    const stalk = new THREE.Mesh(GEOMETRY.body, trimMat);
    stalk.scale.set(0.2, 0.035, 0.035);
    stalk.position.set(side * (cabW / 2 + 0.09), cabY + 0.02, mirrorZ);
    group.add(stalk);
    const mirror = new THREE.Mesh(GEOMETRY.body, paint);
    mirror.scale.set(0.05, 0.12, 0.16);
    mirror.position.set(side * (cabW / 2 + 0.2), cabY + 0.02, mirrorZ);
    group.add(mirror);
  }

  if (isWedge) {
    // Cowl: bridges the low sloped hood up to the (unchanged-height) canopy
    // base so the windshield never floats above the nose.
    const cowl = new THREE.Mesh(GEOMETRY.body, paint);
    cowl.scale.set(1.6, 0.34, 0.7);
    cowl.position.set(0, 0.85, 0.62);
    cowl.castShadow = true;
    group.add(cowl);
    // Rear wing: a thin painted blade on two dark stalks at the rear deck.
    const wing = new THREE.Mesh(GEOMETRY.body, paint);
    wing.scale.set(1.7, 0.06, 0.36);
    wing.position.set(0, 1.02, -2.1);
    wing.castShadow = true;
    group.add(wing);
    for (const side of [1, -1]) {
      const stalk = new THREE.Mesh(GEOMETRY.body, trimMat);
      stalk.scale.set(0.08, 0.24, 0.12);
      stalk.position.set(side * 0.55, 0.87, -2.1);
      group.add(stalk);
      // Side skirt: a thin low dark box along the sill between the wheels.
      const skirt = new THREE.Mesh(GEOMETRY.body, trimMat);
      skirt.scale.set(0.12, 0.16, 2.6);
      skirt.position.set(side * 0.99, 0.3, 0);
      group.add(skirt);
    }
  }

  if (isHauler) {
    // Open pickup bed behind the cab: dark floor, painted side walls,
    // bulkhead and tailgate — no rear cabin.
    const bedFloor = new THREE.Mesh(GEOMETRY.body, trimMat);
    bedFloor.scale.set(1.62, 0.08, 1.5);
    bedFloor.position.set(0, 0.97, -1.28);
    group.add(bedFloor);
    for (const side of [1, -1]) {
      const wall = new THREE.Mesh(GEOMETRY.body, paint);
      wall.scale.set(0.1, 0.3, 1.5);
      wall.position.set(side * 0.85, 1.08, -1.28);
      wall.castShadow = true;
      group.add(wall);
    }
    const bulkhead = new THREE.Mesh(GEOMETRY.body, paint);
    bulkhead.scale.set(1.7, 0.3, 0.1);
    bulkhead.position.set(0, 1.08, -0.55);
    group.add(bulkhead);
    const tailgate = new THREE.Mesh(GEOMETRY.body, paint);
    tailgate.scale.set(1.7, 0.26, 0.08);
    tailgate.position.set(0, 1.06, -2.0);
    group.add(tailgate);
  }

  if (isTaxi) {
    // Lit roof sign: a small warm emissive box on the cabin roof.
    const sign = new THREE.Mesh(GEOMETRY.body, taxiSignMat);
    sign.scale.set(0.52, 0.16, 0.24);
    sign.position.set(0, cabY + cabH / 2 + 0.08, cabZ);
    group.add(sign);
  }

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