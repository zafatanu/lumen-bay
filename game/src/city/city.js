// LUMEN BAY city builder: a deterministic 8x8 grid island with five districts,
// a coastal boardwalk, beach and ocean, palms, street props, and a marina
// ferris wheel. Everything is built procedurally from a seeded rng.
import * as THREE from 'three';
import { WORLD, COAST, SEA, DISTRICTS, SPAWN, SUNSET } from '../config.js';
import { makeFacadeTexture, registerAmbient } from '../render/scene.js';
import { rand, randInt, pick } from '../random.js';

// Ambient dressing lists: filled during the build, ticked by one updater
// registered with the render loop. Visual only — nothing here feeds gameplay,
// and phases derive from world positions so no rng draws are spent (the
// seeded city layout stays byte-identical).
let swayCrowns = [];
let lampGlows = [];
let facadeTex = [];
let cruiserBar = null;

/** Queue a lamp head for a slow glow breathe, phased by its position. */
function queueLamp(material, base, x, z) {
  lampGlows.push({ mat: material, base, phase: x * 2.3 + z * 0.8 });
}

/** Queue a placed palm's crown for gentle sway, phased by its position so
 *  no two palms move in lockstep. */
function queuePalmSway(p) {
  const crown = p.userData.crown;
  crown.userData.sway = {
    phase: p.position.x * 1.3 + p.position.z * 0.7,
    speed: 0.5 + Math.abs(Math.sin(p.position.z * 0.31)) * 0.5,
  };
  swayCrowns.push(crown);
}

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

/** Darken a '#rrggbb' colour by factor f for painted deco trim. */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return (r << 16) | (g << 8) | b;
}

// Painted shop signs (no neon): a small shared set of canvas textures, built
// once and reused across the showcase streets. LUMEN BAY's own words only.
const SIGN_WORDS = ['HOTEL', 'CAFE', 'SURF', 'OCEAN', 'LUMEN', 'BAY', 'TACOS',
  'RECORDS', 'MARINA', 'GULLS', 'ROOK', 'SUNSET'];
const SIGN_BG = ['#2a2438', '#3a2a2e', '#22303a', '#332a3f'];
const signTexCache = new Map();
function signTexture(word) {
  if (signTexCache.has(word)) return signTexCache.get(word);
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = SIGN_BG[word.length % SIGN_BG.length];
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = 'rgba(255,214,150,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(5, 5, 246, 54);
  ctx.fillStyle = '#ffd9a0';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(word, 128, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  signTexCache.set(word, tex);
  return tex;
}
/** A sign board hung flat on a facade; warm paint, faint glow, never neon. */
function signBoard(word, width) {
  const m = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({
    map: signTexture(word), roughness: 0.8, metalness: 0.05,
    emissive: 0xffb26b, emissiveIntensity: 0.12,
  }));
  m.scale.set(width, width * 0.25, 0.16);
  return m;
}

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

/** The ocean plane, laid flat and slightly sunken, plus the beach sand mound
 *  and a cheap additive sun-path aligned with the low sun's bearing. */
function buildWater(group) {
  // Own segmented plane (not the shared unit box) so scene.js can ripple its
  // vertices gently. Same colour/finish and same surface height as before.
  const oceanGeo = new THREE.PlaneGeometry(SEA.extent * 2, WORLD.total * 1.6, 24, 24);
  const ocean = new THREE.Mesh(oceanGeo, new THREE.MeshStandardMaterial({
    color: 0x275f80, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.9,
  }));
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(westEdge() - SEA.extent, SEA.level + 0.5, 0);
  ocean.name = 'ocean'; // scene.js finds it by this name for the swell tick
  group.add(ocean);

  // Sun-path: two additive strips on the water along the sun bearing (the
  // same SUNSET.sunPos the sky dome and key light use). Two meshes, no
  // shaders — the cheapest possible glint lane toward the horizon.
  const sp = SUNSET.sunPos;
  const bearing = Math.atan2(sp.x, sp.z);
  const pathMat = (opacity) => new THREE.MeshBasicMaterial({
    color: SUNSET.sunGlow, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const drift = SEA.extent * 0.6 * (sp.z / Math.abs(sp.x)); // z drift along the bearing
  for (const [width, opacity] of [[18, 0.2], [7, 0.3]]) {
    const path = new THREE.Mesh(GEO.box, pathMat(opacity));
    path.scale.set(width, 0.05, SEA.extent * 1.9);
    path.rotation.y = bearing;
    path.position.set(westEdge() - SEA.extent * 0.6, SEA.level + 0.56, drift);
    group.add(path);
  }

  const sand = new THREE.Mesh(GEO.box, mat(0xe7d3a6));
  sand.scale.set(COAST.beachWidth + COAST.boardwalkWidth, 1, WORLD.total * 1.6);
  sand.position.set(westEdge() - (COAST.beachWidth + COAST.boardwalkWidth) / 2, SEA.sandLevel, 0);
  sand.receiveShadow = true;
  group.add(sand);
}

/** Boardwalk planks running the full coastal length, with an ocean-side
 *  railing, warm lamp heads and planters — the screenshot-facing promenade. */
function buildBoardwalk(group, rng) {
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

  // Low concrete seawall on the ocean side of the boardwalk, rising from
  // the sand to just under the railing.
  const seaWall = new THREE.Mesh(GEO.box, mat(0xb9b2a4));
  seaWall.scale.set(0.8, 1.0, len);
  seaWall.position.set(westEdge() - 0.5, 0.1, 0);
  group.add(seaWall);

  // Railing on the ocean edge: posts + one continuous top rail.
  const railMat = mat(0x8a6b4a);
  const railX = westEdge() + 0.4;  for (let z = -len / 2; z <= len / 2; z += 7) {
    const post = new THREE.Mesh(GEO.box, railMat);
    post.scale.set(0.12, 1.0, 0.12);
    post.position.set(railX, 0.6, z);
    group.add(post);
  }
  const rail = new THREE.Mesh(GEO.box, railMat);
  rail.scale.set(0.1, 0.09, len);
  rail.position.set(railX, 1.1, 0);
  group.add(rail);

  // Selective warm lamps along the promenade (every ~60m, not a light strip).
  const poleMat = mat(0x3a3f46);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffd9a0, emissive: 0xffb26b, emissiveIntensity: 1.1,
  });
  for (let z = -len / 2 + 24; z < len / 2 - 12; z += 60) {
    const pole = new THREE.Mesh(GEO.cylinder, poleMat);
    pole.scale.set(0.1, 3.6, 0.1);
    pole.position.set(westEdge() + COAST.boardwalkWidth - 0.6, 1.8, z + rand(rng, -4, 4));
    group.add(pole);
    const head = new THREE.Mesh(GEO.sphere, headMat.clone());
    head.scale.set(0.55, 0.55, 0.55);
    head.position.set(pole.position.x, 3.75, pole.position.z);
    group.add(head);
    queueLamp(head.material, 1.1, pole.position.x, pole.position.z);
  }

  // Planters on the inland edge: terracotta box + a clipped shrub.
  const potMat = mat(0xb87a5a);
  const shrubMat = mat(0x4f7a4a);
  for (let z = -len / 2 + 14; z < len / 2 - 10; z += rand(rng, 24, 34)) {
    const pot = new THREE.Mesh(GEO.box, potMat);
    pot.scale.set(1.4, 0.7, 1.4);
    pot.position.set(westEdge() + COAST.boardwalkWidth + 0.9, 0.35, z);
    group.add(pot);
    const shrub = new THREE.Mesh(GEO.sphere, shrubMat);
    shrub.scale.set(1.3, 0.9, 1.3);
    shrub.position.set(pot.position.x, 1.0, z);
    group.add(shrub);
  }
}

/** One palm: leaning cylinder trunk + a fan of cone fronds. The fronds hang
 *  off one crown group so ambient sway can rock the head around the trunk
 *  top without touching the trunk. */
function makePalm(rng, trunkMat, frondMat, h) {
  const p = new THREE.Group();
  const trunk = new THREE.Mesh(GEO.cylinder, trunkMat);
  trunk.scale.set(0.28, h, 0.28);
  trunk.position.y = h / 2;
  trunk.rotation.z = rand(rng, -0.18, 0.18);
  p.add(trunk);
  const crown = new THREE.Group();
  crown.position.y = h + 0.3;
  for (let f = 0; f < 5; f += 1) {
    const frond = new THREE.Mesh(GEO.cone, frondMat);
    frond.scale.set(1.1, 0.9 + rng() * 0.9, 0.9);
    const ang = (f / 5) * Math.PI * 2 + rng();
    frond.rotation.x = 1.5;
    frond.rotation.y = ang;
    crown.add(frond);
  }
  p.add(crown);
  p.userData.crown = crown;
  return p;
}

/** Palms in UNEVEN clusters: a boulevard row with random gaps and doubled-up
 *  trunks, plus a sparser beach row out on the sand. No metronome spacing. */
function buildPalms(group, rng) {
  const trunkMat = mat(0x7a5230);
  const frondMat = mat(0x3f7a3f);

  // Boulevard row: clusters of 1-3 with irregular gaps.
  let z = -WORLD.total / 2 + 10;
  while (z < WORLD.total / 2 - 10) {
    const n = 1 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.2 ? 1 : 0);
    for (let i = 0; i < n; i += 1) {
      const x = westEdge() + COAST.boulevardWidth + rand(rng, 0, 6);
      const p = makePalm(rng, trunkMat, frondMat, 3.5 + rand(rng, 0, 1.6));
      p.position.set(x + rand(rng, -1.5, 1.5), 0, z + rand(rng, -3, 3));
      group.add(p);
      queuePalmSway(p);
    }
    z += rand(rng, 13, 34);
  }

  // Beach row: taller palms out on the sand, wider irregular gaps.
  z = -WORLD.total / 2 + 20;
  while (z < WORLD.total / 2 - 16) {
    const n = rng() < 0.35 ? 2 : 1;
    for (let i = 0; i < n; i += 1) {
      const p = makePalm(rng, trunkMat, frondMat, 4.5 + rand(rng, 0, 1.8));
      p.position.set(westEdge() - rand(rng, 6, 30), SEA.sandLevel, z + rand(rng, -5, 5));
      group.add(p);
      queuePalmSway(p);
    }
    z += rand(rng, 30, 62);
  }
}

/** A single low-poly building with a canvas facade, placed with given scale.
 *  (nx, nz) is the outward street-facing normal, so awnings, balconies and
 *  signs land on the face the street sees. Deco districts get silhouette
 *  dressing: corner fins, a stepped setback crown, a canopy skirt, balconies,
 *  a painted sign and extra roof equipment. */
function buildBuilding(group, district, rng, x, z, w, d, nx = 0, nz = 1) {
  const deco = district.deco === true;
  const floors = Math.max(2, Math.round(district.maxH / 3));
  const tex = makeFacadeTexture(district.palette, floors, rng, deco);
  facadeTex.push(tex); // ambient window toggles pick from these
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

  if (!deco) return mesh;

  const trimMat = mat(shade(roof, 0.72));
  const darkMat = mat(shade(roof, 0.55));

  // Stepped setback crown: a smaller upper storey, slightly off-centre, so
  // the roofline steps instead of ending in a flat slab.
  if (rng() < 0.7) {
    const cw = w * (0.42 + rng() * 0.2);
    const cd = d * (0.42 + rng() * 0.2);
    const ch = 1.6 + rng() * 2.4;
    const crown = new THREE.Mesh(GEO.box, trimMat);
    crown.scale.set(cw, ch, cd);
    crown.position.set(x + rand(rng, -w * 0.12, w * 0.12), h + 0.8 + ch / 2, z + rand(rng, -d * 0.12, d * 0.12));
    group.add(crown);
    // A slim fin on top of the crown — the deco spike on the skyline.
    const spike = new THREE.Mesh(GEO.box, darkMat);
    spike.scale.set(0.5, 1.6 + rng() * 1.4, 0.5);
    spike.position.set(crown.position.x, h + 0.8 + ch + spike.scale.y / 2, crown.position.z);
    group.add(spike);
  }

  // Vertical fins at the two outward corners: full-height painted strips
  // that break the flat facade plane from every street angle.
  const finH = h * 0.96;
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(GEO.box, trimMat);
    if (nz !== 0) {
      fin.scale.set(0.55, finH, 0.35);
      fin.position.set(x + s * (w / 2 - 0.3), finH / 2, z + nz * (d / 2 + 0.12));
    } else {
      fin.scale.set(0.35, finH, 0.55);
      fin.position.set(x + nx * (w / 2 + 0.12), finH / 2, z + s * (d / 2 - 0.3));
    }
    group.add(fin);
  }

  // Canopy skirt over the ground-floor shopfront, slightly sloped.
  const awn = new THREE.Mesh(GEO.box, mat(shade(roof, 0.6)));
  if (nz !== 0) {
    awn.scale.set(w * 0.72, 0.18, 1.9);
    awn.position.set(x, 3.4, z + nz * (d / 2 + 0.85));
    awn.rotation.x = nz * 0.1;
  } else {
    awn.scale.set(1.9, 0.18, d * 0.72);
    awn.position.set(x + nx * (w / 2 + 0.85), 3.4, z);
    awn.rotation.z = -nx * 0.1;
  }
  group.add(awn);

  // Balcony slabs on the outward face, with a thin rail on the outer edge.
  if (rng() < 0.55) {
    const nBal = 1 + (rng() < 0.5 ? 1 : 0);
    for (let b = 0; b < nBal; b += 1) {
      const by = h * (0.42 + b * 0.28);
      const slab = new THREE.Mesh(GEO.box, trimMat);
      const rail = new THREE.Mesh(GEO.box, darkMat);
      if (nz !== 0) {
        slab.scale.set(w * 0.42, 0.22, 1.15);
        slab.position.set(x + rand(rng, -w * 0.2, w * 0.2), by, z + nz * (d / 2 + 0.55));
        rail.scale.set(w * 0.42, 0.7, 0.08);
        rail.position.set(slab.position.x, by + 0.45, z + nz * (d / 2 + 1.08));
      } else {
        slab.scale.set(1.15, 0.22, d * 0.42);
        slab.position.set(x + nx * (w / 2 + 0.55), by, z + rand(rng, -d * 0.2, d * 0.2));
        rail.scale.set(0.08, 0.7, d * 0.42);
        rail.position.set(x + nx * (w / 2 + 1.08), by + 0.45, slab.position.z);
      }
      group.add(slab);
      group.add(rail);
    }
  }

  // One painted sign board on the outward face — warm paint, never neon.
  if (rng() < 0.45) {
    const sign = signBoard(pick(rng, SIGN_WORDS), 5 + rng() * 3);
    if (nz !== 0) {
      sign.position.set(x + rand(rng, -w * 0.15, w * 0.15), 5.6 + rng() * 2, z + nz * (d / 2 + 0.18));
    } else {
      sign.rotation.y = Math.PI / 2;
      sign.position.set(x + nx * (w / 2 + 0.18), 5.6 + rng() * 2, z + rand(rng, -d * 0.15, d * 0.15));
    }
    group.add(sign);
  }

  // Extra roof furniture on deco roofs: a vent stack and, sometimes, a
  // cylindrical water tank with a cone cap — more silhouette variety up top.
  if (rng() < 0.5) {
    const vent = new THREE.Mesh(GEO.cylinder, mat(0x7a7f88));
    vent.scale.set(0.5, 1.0, 0.5);
    vent.position.set(x + rand(rng, -w / 4, w / 4), h + 1.3, z + rand(rng, -d / 4, d / 4));
    group.add(vent);
  }
  if (rng() < 0.35) {
    const tank = new THREE.Mesh(GEO.cylinder, mat(0x9a7a5a));
    tank.scale.set(1.5, 2.0, 1.5);
    tank.position.set(x + rand(rng, -w / 4, w / 4), h + 1.8, z + rand(rng, -d / 4, d / 4));
    group.add(tank);
    const cap = new THREE.Mesh(GEO.cone, mat(0x7a5a42));
    cap.scale.set(1.6, 0.9, 1.6);
    cap.position.set(tank.position.x, h + 3.2, tank.position.z);
    group.add(cap);
  }
  return mesh;
}

/** Build a full city block: a ring of buildings around a leafy court. */
function buildBlock(group, district, rng, bx, bz) {
  const lot = WORLD.block;
  const inset = 2;
  const faces = [
    { x: 0, z: lot * 0.28, w: lot - inset * 2, d: lot * 0.26, nx: 0, nz: 1 },
    { x: 0, z: -lot * 0.28, w: lot - inset * 2, d: lot * 0.26, nx: 0, nz: -1 },
    { x: lot * 0.28, z: 0, w: lot * 0.26, d: lot - inset * 2, nx: 1, nz: 0 },
    { x: -lot * 0.28, z: 0, w: lot * 0.26, d: lot - inset * 2, nx: -1, nz: 0 },
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
      buildBuilding(group, district, rng, bx + f.x + px, bz + f.z + pz, pw, pd, f.nx, f.nz);
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
    const head = new THREE.Mesh(GEO.box, lightMat.clone());
    head.scale.set(1.6, 0.3, 0.5);
    head.position.set(0, 5.1, 0);
    lamp.add(head);
    lamp.position.set(westEdge() + COAST.boulevardWidth + 1, 0, z);
    group.add(lamp);
    queueLamp(head.material, 0.6, lamp.position.x, z);
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
      const bulb = new THREE.Mesh(GEO.box, lightMat.clone());
      bulb.scale.set(0.5, 0.5, 0.5);
      bulb.position.set(0, 4.2, 0);
      t.add(bulb);
      t.position.set(x, 0, z);
      group.add(t);
      queueLamp(bulb.material, 0.6, x, z);
    }
  }
}

/** Screenshot-facing street props on the first coastal road: parked cars on
 *  the west kerb, power poles on the east kerb. Dressing only — no gameplay
 *  effect, no colliders, nothing moves. */
function buildBoulevardProps(group, rng) {
  const roadX = westEdge() + WORLD.block + WORLD.road; // first N-S road centre
  const carCols = [0xc94f4f, 0x4f7dc9, 0xe0b23b, 0x7a8a99, 0xd8d3c8, 0x5a9a6a, 0x8a6fb0];
  // Parked cars along the west kerb, with uneven gaps and flipped headings.
  let z = -WORLD.total / 2 + 30;
  while (z < WORLD.total / 2 - 30) {
    if (rng() < 0.7) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(GEO.box, mat(pick(rng, carCols), 0x18101c));
      body.scale.set(1.9, 0.75, 4.4);
      body.position.y = 0.55;
      car.add(body);
      const cabin = new THREE.Mesh(GEO.box, mat(0x2a3138, 0x0a0c10));
      cabin.scale.set(1.7, 0.6, 2.2);
      cabin.position.set(0, 1.2, -0.2);
      car.add(cabin);
      car.position.set(roadX - WORLD.road / 2 + 1.6, 0, z + rand(rng, -2, 2));
      car.rotation.y = (rng() < 0.5 ? 0 : Math.PI) + rand(rng, -0.06, 0.06);
      group.add(car);
    }
    z += rand(rng, 12, 26);
  }
  // Power poles on the east kerb of the same road, uneven gaps.
  const poleMat = mat(0x5a4632);
  for (let pz = -WORLD.total / 2 + 20; pz < WORLD.total / 2 - 20; pz += 44) {
    if (rng() < 0.25) continue;
    const pole = new THREE.Mesh(GEO.cylinder, poleMat);
    pole.scale.set(0.22, 7.5, 0.22);
    pole.position.set(roadX + WORLD.road / 2 - 1.2, 3.75, pz + rand(rng, -3, 3));
    group.add(pole);
    const arm = new THREE.Mesh(GEO.box, poleMat);
    arm.scale.set(0.18, 0.18, 2.4);
    arm.position.set(pole.position.x, 6.9, pole.position.z);
    group.add(arm);
  }
}

/** A parked police cruiser on the east kerb of the first coastal road, at
 *  the spawn latitude — ambient presence only, in the same navy/white livery
 *  as the pursuit units. No collider, no AI, no traffic change: it sits clear
 *  of both drive lanes (road centre ±3m) and of the power-pole line, and its
 *  lightbar pulses on the ambient tick. */
function buildParkedCruiser(group) {
  const roadX = westEdge() + WORLD.block + WORLD.road; // first N-S road centre
  const car = new THREE.Group();
  const body = new THREE.Mesh(GEO.box, mat(0x1c2a52, 0x0a0c14));
  body.scale.set(1.9, 0.75, 4.4);
  body.position.y = 0.55;
  car.add(body);
  // White door band + cabin: the two-tone reads as police at a glance.
  const doors = new THREE.Mesh(GEO.box, mat(0xeef1f6));
  doors.scale.set(1.94, 0.34, 2.3);
  doors.position.set(0, 0.62, -0.2);
  car.add(doors);
  const cabin = new THREE.Mesh(GEO.box, mat(0xeef1f6, 0x0a0c10));
  cabin.scale.set(1.7, 0.6, 2.2);
  cabin.position.set(0, 1.2, -0.2);
  car.add(cabin);
  const glass = new THREE.Mesh(GEO.box, mat(0x0c1622));
  glass.scale.set(1.72, 0.3, 1.9);
  glass.position.set(0, 1.28, -0.2);
  car.add(glass);
  // Roof lightbar: red/blue lamps, swapped slowly by the ambient updater.
  const bar = new THREE.Mesh(GEO.box, mat(0x2a3138));
  bar.scale.set(0.9, 0.1, 0.5);
  bar.position.set(0, 1.56, -0.3);
  car.add(bar);
  const redMat = new THREE.MeshStandardMaterial({ color: 0x660000, emissive: 0xff2020, emissiveIntensity: 1.2 });
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x000a55, emissive: 0x2a6bff, emissiveIntensity: 0.2 });
  const red = new THREE.Mesh(GEO.box, redMat);
  red.scale.set(0.36, 0.16, 0.44);
  red.position.set(-0.22, 1.66, -0.3);
  car.add(red);
  const blue = new THREE.Mesh(GEO.box, blueMat);
  blue.scale.set(0.36, 0.16, 0.44);
  blue.position.set(0.22, 1.66, -0.3);
  car.add(blue);
  cruiserBar = { redMat, blueMat };
  car.position.set(roadX + WORLD.road / 2 - 1.6, 0, SPAWN.z);
  car.rotation.y = Math.PI + 0.04;
  group.add(car);
}

/** Main entry: build the whole island into a THREE.Group. */
export function createCity(scene, rng) {
  const group = new THREE.Group();
  scene.add(group);

  // Reset the ambient lists so a rebuild never doubles up dressing ticks.
  swayCrowns = [];
  lampGlows = [];
  facadeTex = [];
  cruiserBar = null;

  buildGround(group);
  buildWater(group);
  buildBoardwalk(group, rng);
  buildPalms(group, rng);
  buildBoulevardProps(group, rng);
  buildParkedCruiser(group);

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

  // One ambient tick for all the dressing above — visual only, driven by the
  // render loop, never by the simulation step.
  let winTimer = 2;
  registerAmbient((time, dt) => {
    // Palm crowns rock gently, each on its own phase and speed.
    for (const crown of swayCrowns) {
      const s = crown.userData.sway;
      crown.rotation.z = Math.sin(time * s.speed + s.phase) * 0.06;
      crown.rotation.x = Math.cos(time * s.speed * 0.8 + s.phase) * 0.05;
    }
    // Lamp heads breathe ±10% around their base glow, out of sync.
    for (const lamp of lampGlows) {
      lamp.mat.emissiveIntensity = lamp.base * (0.9 + 0.1 * Math.sin(time * 1.6 + lamp.phase));
    }
    // Every few seconds a handful of windows flip on/off across the island.
    winTimer -= dt;
    if (winTimer <= 0 && facadeTex.length) {
      winTimer = 1.5 + Math.random() * 2.5;
      const flips = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < flips; i += 1) {
        const tex = facadeTex[Math.floor(Math.random() * facadeTex.length)];
        const wins = tex.userData.windows;
        if (!wins.length) continue;
        const win = wins[Math.floor(Math.random() * wins.length)];
        win.lit = !win.lit;
        const ctx = tex.image.getContext('2d');
        const { winW, winH, wall } = tex.userData;
        if (!win.lit) {
          // Repaint the wall first so the dark glass blends as originally.
          ctx.fillStyle = wall;
          ctx.fillRect(win.x, win.y, winW, winH);
        }
        ctx.fillStyle = win.lit ? '#ffc978' : 'rgba(24,28,44,0.85)';
        ctx.fillRect(win.x, win.y, winW, winH);
        tex.needsUpdate = true;
      }
    }
    // The parked cruiser's lightbar swaps red/blue on a slow idle pulse.
    if (cruiserBar) {
      const red = Math.sin(time * 2.1) > 0;
      cruiserBar.redMat.emissiveIntensity = red ? 1.2 : 0.2;
      cruiserBar.blueMat.emissiveIntensity = red ? 0.2 : 1.2;
    }
  });

  return { group, districts, roads: districts, colliders, spawnPoints, wheel };
}