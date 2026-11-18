// LUMEN BAY car catalogue and low-poly car builder.
// Eight original cars, each a compact THREE.Group: body box, cabin box,
// four cylinder wheels, dark window boxes and emissive headlights.
// The catalog is shared by the parked starter car, traffic and car stealing.
import * as THREE from 'three';

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
};

/** Emissive windshield glass so cars read at dusk. */
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0c1622, roughness: 0.15, metalness: 0.6 });

function bodyMat(colour) {
  return new THREE.MeshStandardMaterial({ color: colour, roughness: 0.4, metalness: 0.45 });
}

/** Build a low-poly car mesh from a catalog definition.
 *  Returns a THREE.Group positioned at the origin, oriented +Z forward,
 *  with `.userData.def` set to the catalog entry and `.userData.body` holding
 *  the wheel collider radius for physics. */
export function buildCarMesh(def) {
  const group = new THREE.Group();
  const paint = bodyMat(def.colour);

  const body = new THREE.Mesh(GEOMETRY.body, paint);
  body.scale.set(1.9, 0.62, 4.1);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);

  // Cabin: a smaller box on top. The convertible sits lower with no top box.
  const isConvertible = def.name === 'Coral Cruiser';
  const cab = new THREE.Mesh(GEOMETRY.body, paint);
  const cabH = isConvertible ? 0.42 : 0.62;
  cab.scale.set(1.5, cabH, 2.0);
  cab.position.set(0, body.position.y + 0.42, -0.2);
  cab.castShadow = true;
  group.add(cab);

  // Windows: dark glass boxes inset into the cabin sides and front/rear.
  const winH = isConvertible ? 0.2 : 0.34;
  for (const [dx, dz, w, d] of [
    [0, 0.1, 0.2, 1.7],  // front
    [0, -0.6, 0.2, 1.0], // rear
    [0.78, -0.2, 0.18, 1.7], // left
    [-0.78, -0.2, 0.18, 1.7], // right
  ]) {
    const win = new THREE.Mesh(GEOMETRY.body, glassMat);
    win.scale.set(w, winH, d);
    win.position.set(dx, body.position.y + 0.42 + winH / 2, dz);
    group.add(win);
  }

  // Wheels: four dark cylinders, radius 0.34, each on its own axle group so
  // the driving code can roll it around its local Z (the axle) without the
  // wheel cylinder's own pitch rotating the contact patch off the road.
  const wheelGeo = GEOMETRY.wheel;
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.9, metalness: 0.1 });
  const wR = 0.34;
  const wHalf = 0.16;
  for (const [x, z] of [[1.05, 1.25], [-1.05, 1.25], [1.05, -1.25], [-1.05, -1.25]]) {
    const axle = new THREE.Group();
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    w.scale.set(wHalf, wR * 2, wR * 2);
    w.rotation.z = Math.PI / 2;
    axle.add(w);
    axle.position.set(x, wR, z);
    axle.userData.wheel = true;
    group.add(axle);
  }

  // Headlights: two small emissive boxes at the front.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd9a0, emissiveIntensity: 1.4 });
  for (const x of [0.55, -0.55]) {
    const h = new THREE.Mesh(GEOMETRY.body, lightMat);
    h.scale.set(0.3, 0.16, 0.12);
    h.position.set(x, 0.74, 2.06);
    group.add(h);
  }

  // Tail lights: two red emissive strips at the back.
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2f2f, emissive: 0xff2f2f, emissiveIntensity: 0.8 });
  for (const x of [0.6, -0.6]) {
    const t = new THREE.Mesh(GEOMETRY.body, tailMat);
    t.scale.set(0.5, 0.16, 0.12);
    t.position.set(x, 0.66, -2.06);
    group.add(t);
  }

  // A wheel radius the driving physics uses for the circle collider.
  group.userData.def = def;
  group.userData.body = { r: wHalf + 0.1, length: 4.3 };
  return group;
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