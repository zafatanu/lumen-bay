// LUMEN BAY city builder: a deterministic 8x8 grid island with five districts,
// a coastal boardwalk, beach and ocean, palms, street props, and a marina
// ferris wheel. Everything is built procedurally from a seeded rng.
import * as THREE from 'three';
import { WORLD, COAST, SEA, DISTRICTS, SPAWN } from '../config.js';
import { makeFacadeTexture } from '../render/scene.js';
import { rand, randInt, pick } from '../random.js';

// Concrete geometry shared across the whole city so we only make it once.
// Every building/box/palm reuses these units, which keeps the draw call and
// vertex budget flat however dense the island looks in a frame.
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  cone: new THREE.ConeGeometry(0.5, 1, 7),
  sphere: new THREE.SphereGeometry(0.5, 8, 6),
};

/** Cheap matte material factory so identical blocks share GPU programs. */
const mat = (color, emissive = 0x000000) => new THREE.MeshStandardMaterial({
  color, emissive, roughness: 0.9, metalness: 0.05,
});

/** World x of the west (coastal) edge of the island grid. */
function westEdge() {
  return -WORLD.total / 2;
}

/** Build the flat ground with road markings painted onto one big canvas. */
function buildGround(group) {
  const size = WORLD.total;
  const px = 1024;
  const cv = document.createElement('canvas');
  cv.width = px;
  cv.height = px;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#9aa479';
  ctx.fillRect(0, 0, px, px);

  // Paint road lanes (both axes) across the whole grid.
  ctx.fillStyle = '#3a3f46';
  const step = WORLD.block + WORLD.road;
  const roadPx = (WORLD.road / size) * px;
  for (let i = 1; i < WORLD.blocks; i += 1) {
    const at = (i * step / size) * px;
    ctx.fillRect(at - roadPx / 2, 0, roadPx, px);
    ctx.fillRect(0, at - roadPx / 2, px, roadPx);
  }

  // Dashed centre line on every road.
  ctx.fillStyle = '#e8e3c8';
  const dash = roadPx * 0.18;
  for (let i = 1; i < WORLD.blocks; i += 1) {
    const at = (i * step / size) * px;
    for (let j = 0; j < px; j += dash * 2) {
      ctx.fillRect(at - 1, j, 2, dash);
      ctx.fillRect(j, at - 1, dash, 2);
    }
  }

  // Sand strip along the west (coastal) edge.
  ctx.fillStyle = '#e7d3a6';
  const beachPx = ((COAST.beachWidth + COAST.boardwalkWidth + COAST.boulevardWidth) / size) * px;
  ctx.fillRect(0, 0, beachPx, px);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  ground.scale.set(size, 1, size);
  ground.position.set(0, -0.5, 0);
  ground.receiveShadow = true;
  group.add(ground);
  return ground;
}

/** The ocean plane, laid flat and slightly sunken, plus the beach sand mound. */
function buildWater(group) {
  const ocean = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({
    color: 0x2a6a8a, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.9,
  }));
  ocean.scale.set(SEA.extent * 2, 1, WORLD.total * 1.6);
  ocean.position.set(westEdge() - SEA.extent, SEA.level, 0);
  group.add(ocean);

  const sand = new THREE.Mesh(GEO.box, mat(0xe7d3a6));
  sand.scale.set(COAST.beachWidth + COAST.boardwalkWidth, 1, WORLD.total * 1.6);
  sand.position.set(westEdge() - (COAST.beachWidth + COAST.boardwalkWidth) / 2, SEA.sandLevel, 0);
  sand.receiveShadow = true;
  group.add(sand);
}

/** Boardwalk planks running the full coastal length. */
function buildBoardwalk(group) {
  const len = WORLD.total * 1.4;
  const plankMat = mat(0xc98f5e);
  const count = 46;
  for (let i = 0; i < count; i += 1) {
    const z = -len / 2 + (i + 0.5) * (len / count);
    const plank = new THREE.Mesh(GEO.box, plankMat);
    plank.scale.set(COAST.boardwalkWidth, 0.12, COAST.boardwalkPlank + 0.02);
    plank.position.set(westEdge() + COAST.boardwalkWidth / 2, 0.06, z);
    group.add(plank);
  }
}

/** Palms lining the boulevard and beach: cylinder trunk + cone fronds. */
function buildPalms(group, rng) {
  const trunkMat = mat(0x7a5230);
  const frondMat = mat(0x3f7a3f);
  const spacing = 22;
  for (let z = -WORLD.total / 2 + 8; z < WORLD.total / 2 - 8; z += spacing) {
    const x = westEdge() + COAST.boulevardWidth + rand(rng, 0, 6);
    const p = new THREE.Group();
    const trunk = new THREE.Mesh(GEO.cylinder, trunkMat);
    const h = 3.5 + rand(rng, 0, 1.6);
    trunk.scale.set(0.28, h, 0.28);
    trunk.position.y = h / 2;
    trunk.rotation.z = rand(rng, -0.18, 0.18);
    p.add(trunk);
    for (let f = 0; f < 5; f += 1) {
      const frond = new THREE.Mesh(GEO.cone, frondMat);
      frond.scale.set(1.1, 0.9 + rng() * 0.9, 0.9);
      frond.position.y = h + 0.3;
      const ang = (f / 5) * Math.PI * 2 + rng();
      frond.rotation.x = 1.5;
      frond.rotation.y = ang;
      p.add(frond);
    }
    p.position.set(x, 0, z + rand(rng, -4, 4));
    group.add(p);
  }
}

/** A single low-poly building with a canvas facade, placed with given scale. */
function buildBuilding(group, district, rng, x, z, w, d) {
  const floors = Math.max(2, Math.round(district.maxH / 3));
  const tex = makeFacadeTexture(district.palette, floors, rng);
  const roof = pick(rng, district.palette);
  const h = rand(rng, district.minH, district.maxH);
  const mesh = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.92, metalness: 0.02,
  }));
  mesh.scale.set(w, h, d);
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const roofMesh = new THREE.Mesh(GEO.box, mat(roof, 0x18101c));
  roofMesh.scale.set(w * 1.06, 0.8, d * 1.06);
  roofMesh.position.set(x, h + 0.4, z);
  group.add(roofMesh);

  // Some buildings get an air-conditioner box on the roof for silhouette.
  if (rng() < 0.3) {
    const ac = new THREE.Mesh(GEO.box, mat(0x8a929c));
    ac.scale.set(w * 0.3, 0.6, d * 0.3);
    ac.position.set(x + rand(rng, -w / 4, w / 4), h + 1.1, z + rand(rng, -d / 4, d / 4));
    group.add(ac);
  }
  return mesh;
}

/** Build a full city block: a ring of buildings around a leafy court. */
function buildBlock(group, district, rng, bx, bz) {
  const lot = WORLD.block;
  const inset = 2;
  const faces = [
    { x: 0, z: lot * 0.28, w: lot - inset * 2, d: lot * 0.26 },
    { x: 0, z: -lot * 0.28, w: lot - inset * 2, d: lot * 0.26 },
    { x: lot * 0.28, z: 0, w: lot * 0.26, d: lot - inset * 2 },
    { x: -lot * 0.28, z: 0, w: lot * 0.26, d: lot - inset * 2 },
  ];
  for (let i = 0; i < faces.length; i += 1) {
    const f = faces[i];
    // Subdivide the long faces into 2-3 shopfronts for variety.
    const horizontal = f.w > f.d;
    const main = horizontal ? f.w : f.d;
    const sub = 1 + (rng() < 0.5 ? 1 : 0);
    const piece = (main - inset) / sub;
    for (let s = 0; s < sub; s += 1) {
      const off = -main / 2 + inset / 2 + piece * (s + 0.5);
      const px = horizontal ? off : 0;
      const pz = horizontal ? 0 : off;
      const pw = horizontal ? piece : f.w;
      const pd = horizontal ? f.d : piece;
      buildBuilding(group, district, rng, bx + f.x + px, bz + f.z + pz, pw, pd);
    }
  }
}

/** Downtown neon signs: emissive boxes hung on the lower facades. */
function buildNeon(group, rng, bx, bz) {
  const colours = [0xff3b6b, 0x3bf2ff, 0xffd23b, 0x8bff5a, 0xff8b3b];
  const count = 4 + randInt(rng, 0, 4);
  for (let i = 0; i < count; i += 1) {
    const sign = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: pick(rng, colours) }));
    sign.scale.set(6 + rand(rng, 0, 8), 2 + rand(rng, 0, 2), 0.4);
    sign.position.set(bx + rand(rng, -18, 18), 10 + rand(rng, 0, 12), bz + rand(rng, -18, 18));
    group.add(sign);
  }
}

/** Dockside: stacked shipping containers, a warehouse and two cranes. */
function buildDocks(group, district, rng, bx, bz) {
  const palette = district.palette;
  // Warehouse shell.
  const wh = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({
    map: makeFacadeTexture(palette, 2, rng), roughness: 0.95, metalness: 0.05,
  }));
  wh.scale.set(46, 12, 26);
  wh.position.set(bx + 8, 6, bz - 6);
  wh.castShadow = true;
  wh.receiveShadow = true;
  group.add(wh);

  // Container colours.
  const cCols = [0xd2473b, 0x2f7fd2, 0x3c8f4f, 0xe0b23b, 0x7a7f88];
  for (let i = 0; i < 18; i += 1) {
    const c = new THREE.Mesh(GEO.box, mat(pick(rng, cCols), 0x100c10));
    const cw = 8 + rand(rng, 0, 2);
    c.scale.set(cw, 3.2, 3.2);
    c.position.set(bx + rand(rng, -20, 22), 1.6 + (i % 2) * 3.2, bz + 8 + (i % 6) * 4);
    c.castShadow = true;
    group.add(c);
  }

  // Two crane towers at the water's edge (west) of the docks.
  for (let k = 0; k < 2; k += 1) {
    const cx = bx + (k === 0 ? -24 : 8);
    const base = new THREE.Mesh(GEO.cylinder, mat(0xe0891f, 0x331100));
    base.scale.set(0.8, 16, 0.8);
    base.position.set(cx, 8, bz - 22);
    group.add(base);
    const boom = new THREE.Mesh(GEO.box, mat(0xe0891f, 0x331100));
    boom.scale.set(20, 0.8, 1);
    boom.position.set(cx + 8, 17, bz - 22);
    group.add(boom);
    const cab = new THREE.Mesh(GEO.box, mat(0x6b4422));
    cab.scale.set(2.4, 2.4, 2.4);
    cab.position.set(cx - 3, 13.4, bz - 22);
    group.add(cab);
  }
}

/** Marina: pier deck, boats and the big rotating ferris wheel. Returns the wheel. */
function buildMarina(group, district, rng, bx, bz) {
  // Pier deck running out toward the water (west).
  const pier = new THREE.Mesh(GEO.box, mat(0x8a6b4a));
  pier.scale.set(10, 0.4, 40);
  pier.position.set(bx - 20, 0.2, bz);
  group.add(pier);

  // A few bobbing pleasure boats moored alongside.
  const boatCols = [0xffffff, 0x4fb3ff, 0xff8b6b, 0x6bd24f];
  for (let i = 0; i < 6; i += 1) {
    const hull = new THREE.Mesh(GEO.box, mat(pick(rng, boatCols)));
    hull.scale.set(6, 1.6, 2.6);
    hull.position.set(bx - 24 - rand(rng, 0, 3), 0.9, bz - 15 + i * 6);
    group.add(hull);
  }

  const wheel = buildFerrisWheel(rng, bx + 14, bz);
  group.add(wheel); // the wheel group must be added to the scene to be visible
  return wheel;
}

/** Ferris wheel: two supports, a rim, spokes and 12 gondola cars.
 *  The returned Group's userData.spin is the hub, so the main loop just
 *  rotates that one object and every car swings around with it. */
function buildFerrisWheel(rng, bx, bz) {
  const wheel = new THREE.Group();
  wheel.position.set(bx, 0, bz);
  const radius = 16;
  const spokeCol = 0xd8c8a8;
  const metalMat = mat(0x5a5f66, 0x100c10);
  const rimMat = mat(spokeCol);

  // Two leaning A-frame supports.
  const supportA = new THREE.Mesh(GEO.box, metalMat);
  supportA.scale.set(1, 26, 1);
  supportA.position.set(-0.6, 13, 0);
  wheel.add(supportA);
  const supportB = supportA.clone();
  supportB.position.set(0.6, 11, 2.6);
  wheel.add(supportB);

  // The spinning hub carries the rim, spokes and gondola cars.
  const hub = new THREE.Group();
  hub.position.set(0, 26, 0);

  const segCount = 24;
  for (let i = 0; i < segCount; i += 1) {
    const a = (i / segCount) * Math.PI * 2;
    const seg = new THREE.Mesh(GEO.box, rimMat);
    seg.scale.set(1.4, 0.5, 0.5);
    seg.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    seg.rotation.z = a;
    hub.add(seg);
  }

  const carCount = 12;
  const gCols = [0xff6b6b, 0xffb23b, 0x4fd26b, 0x4fb3ff, 0xff7ad0, 0xffffff];
  for (let i = 0; i < carCount; i += 1) {
    const a = (i / carCount) * Math.PI * 2;
    const spoke = new THREE.Mesh(GEO.box, rimMat);
    spoke.scale.set(0.3, radius, 0.3);
    spoke.position.set(Math.cos(a) * radius / 2, Math.sin(a) * radius / 2, 0);
    spoke.rotation.z = a;
    hub.add(spoke);
    const car = new THREE.Mesh(GEO.box, mat(pick(rng, gCols)));
    car.scale.set(2.2, 1.8, 2.2);
    car.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    hub.add(car);
  }
  wheel.add(hub);

  // Expose the spinning hub so the main loop can rotate it each frame.
  wheel.userData.spin = hub;
  return wheel;
}

/** Small street furniture: lamps, hydrants, benches, traffic lights. */
function buildProps(group, rng) {
  const lampCol = 0x3a3f46;
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb26b, emissiveIntensity: 0.6 });

  // Street lamps along the boulevard.
  for (let z = -WORLD.total / 2 + 10; z < WORLD.total / 2 - 10; z += 46) {
    const lamp = new THREE.Group();
    const pole = new THREE.Mesh(GEO.cylinder, mat(lampCol));
    pole.scale.set(0.12, 5, 0.12);
    pole.position.y = 2.5;
    lamp.add(pole);
    const head = new THREE.Mesh(GEO.box, lightMat);
    head.scale.set(1.6, 0.3, 0.5);
    head.position.set(0, 5.1, 0);
    lamp.add(head);
    lamp.position.set(westEdge() + COAST.boulevardWidth + 1, 0, z);
    group.add(lamp);
  }

  // Fire hydrants, benches and traffic lights at random points.
  for (let i = 0; i < 26; i += 1) {
    const kind = rng();
    const x = rand(rng, -WORLD.total / 2, WORLD.total / 2);
    const z = rand(rng, -WORLD.total / 2, WORLD.total / 2);
    if (kind < 0.4) {
      const h = new THREE.Mesh(GEO.cylinder, mat(0xd2473b));
      h.scale.set(0.18, 0.6, 0.18);
      h.position.set(x, 0.3, z);
      group.add(h);
    } else if (kind < 0.7) {
      const b = new THREE.Mesh(GEO.box, mat(0x6b4a2f));
      b.scale.set(1.8, 0.5, 0.7);
      b.position.set(x, 0.25, z);
      group.add(b);
    } else {
      const t = new THREE.Group();
      const pole = new THREE.Mesh(GEO.cylinder, mat(lampCol));
      pole.scale.set(0.1, 4, 0.1);
      pole.position.y = 2;
      t.add(pole);
      const bulb = new THREE.Mesh(GEO.box, lightMat);
      bulb.scale.set(0.5, 0.5, 0.5);
      bulb.position.set(0, 4.2, 0);
      t.add(bulb);
      t.position.set(x, 0, z);
      group.add(t);
    }
  }
}

/** Main entry: build the whole island into a THREE.Group. */
export function createCity(scene, rng) {
  const group = new THREE.Group();
  scene.add(group);

  buildGround(group);
  buildWater(group);
  buildBoardwalk(group);
  buildPalms(group, rng);

  // Walk the 8x8 grid, assigning each block to the nearest district.
  const districts = new Map();
  for (let gy = 0; gy < WORLD.blocks; gy += 1) {
    for (let gx = 0; gx < WORLD.blocks; gx += 1) {
      const cx = westEdge() + (gx + 0.5) * (WORLD.block + WORLD.road);
      const cz = westEdge() + (gy + 0.5) * (WORLD.block + WORLD.road);
      let best = DISTRICTS[0];
      let bestD = Infinity;
      for (const d of DISTRICTS) {
        const dist = (d.centre.x - cx) ** 2 + (d.centre.z - cz) ** 2;
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      if (!districts.has(best.name)) districts.set(best.name, { district: best, blocks: [] });
      districts.get(best.name).blocks.push({ cx, cz });
    }
  }

  for (const entry of districts.values()) {
    const d = entry.district;
    for (const b of entry.blocks) {
      buildBlock(group, d, rng, b.cx, b.cz);
      if (d.name === 'Downtown') buildNeon(group, rng, b.cx, b.cz);
      if (d.name === 'Dockside') buildDocks(group, d, rng, b.cx, b.cz);
    }
  }

  // The marina sits at its district hub block; build it once with its wheel.
  let wheel = null;
  const marina = districts.get('Marina');
  if (marina) {
    wheel = buildMarina(group, marina.district, rng, marina.blocks[0].cx, marina.blocks[0].cz);
  }

  buildProps(group, rng);

  // Road colliders: simple AABB list for the later driving sessions.
  const colliders = [];
  const step = WORLD.block + WORLD.road;
  for (let i = 0; i < WORLD.blocks + 1; i += 1) {
    const at = westEdge() + i * step;
    colliders.push({ x: at, z: 0, w: WORLD.road, d: WORLD.total, axis: 'z' });
    colliders.push({ x: 0, z: at, w: WORLD.total, d: WORLD.road, axis: 'x' });
  }

  const spawnPoints = [
    { x: SPAWN.x, z: SPAWN.z },
    { x: SPAWN.x, z: SPAWN.z + 8 },
    { x: SPAWN.x - 6, z: SPAWN.z + 4 },
  ];

  return { group, districts, roads: districts, colliders, spawnPoints, wheel };
}