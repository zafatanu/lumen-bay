// LUMEN BAY city builder: a deterministic 8x8 grid island with five districts,
// a coastal boardwalk, beach and ocean, palms, street props, and a marina
// ferris wheel. Everything is built procedurally from a seeded rng.
import * as THREE from 'three';
import { WORLD, COAST, SEA, DISTRICTS, SPAWN, SUNSET } from '../config.js';
import { makeFacadeTexture, registerAmbient } from '../render/scene.js';
import { rand, randInt, pick } from '../random.js';
import { snapToRoad } from '../missions/catalog.js';

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

/** Deterministic 0..1 choice hashed from a world position + salt. Dressing
 *  only: same convention as the ambient phases above — no rng draws are
 *  spent, so the seeded city layout (and the traffic/enemy/police draws
 *  that follow it on the shared stream) stays byte-identical. */
function posRand(x, z, salt) {
  let h = (Math.round(x * 374761393) + Math.round(z * 668265263) + Math.imul(salt + 1, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A private rng-like stream hashed from a position, for helpers (makePalm)
 *  that expect an rng function. Spends nothing on the shared seed chain. */
function posRng(x, z) {
  let salt = 0;
  return () => posRand(x, z, salt++);
}

// Shared dressing materials: the boardwalk, boulevard palms and courtyard
// clusters all reuse one instance per finish so GPU programs stay shared.
const PALM_TRUNK = mat(0x7a5230);
const PALM_FROND = mat(0x3f7a3f);
const POT_MAT = mat(0xb87a5a);
const SHRUB_MAT = mat(0x4f7a4a);
const BENCH_MAT = mat(0x6b4a2f);

// Solid footprints ({x,z,w,d}) collected during the build: every ring
// building plus the Dockside warehouse/container yard. buildProps slides
// sidewalk props clear of these so nothing ends up inside a solid.
let propSolids = [];

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
  for (let z = -len / 2 + 14; z < len / 2 - 10; z += rand(rng, 24, 34)) {
    const pot = new THREE.Mesh(GEO.box, POT_MAT);
    pot.scale.set(1.4, 0.7, 1.4);
    pot.position.set(westEdge() + COAST.boardwalkWidth + 0.9, 0.35, z);
    group.add(pot);
    const shrub = new THREE.Mesh(GEO.sphere, SHRUB_MAT);
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
  const trunkMat = PALM_TRUNK;
  const frondMat = PALM_FROND;

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
 *  a painted sign and extra roof equipment. Other districts get a cheap
 *  subset of the same kit (parapet, sign, awning, Downtown setbacks).
 *  If `out` is an array, the building's footprint record is pushed to it. */
function buildBuilding(group, district, rng, x, z, w, d, nx = 0, nz = 1, out = null) {
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

  if (out) out.push({ x, z, w, d, h, nx, nz });

  if (!deco) {
    // Cheap subset of the deco kit for the working districts, all on the
    // existing unit-box + facade pipeline. Choices hash off the building's
    // position (posRand) so no rng draws are spent and the seeded layout
    // stays byte-identical. Footprint, height and collider are untouched.
    const trimMat = mat(shade(roof, 0.72));

    // Parapet step: a slightly smaller flat box on the roof slab, so the
    // roofline reads as a stepped edge instead of one flat slab.
    const parapet = new THREE.Mesh(GEO.box, mat(shade(roof, 0.82)));
    parapet.scale.set(w * 0.94, 0.55, d * 0.94);
    parapet.position.set(x, h + 1.075, z);
    group.add(parapet);

    // Tall Downtown towers step back once (twice when very tall) so the
    // skyline rises in tiers instead of one slab.
    if (district.name === 'Downtown' && h > 40) {
      const s1 = 0.52 + posRand(x, z, 1) * 0.16;
      const ch1 = 3.5 + posRand(x, z, 2) * 4;
      const tier1 = new THREE.Mesh(GEO.box, trimMat);
      tier1.scale.set(w * s1, ch1, d * s1);
      tier1.position.set(
        x + (posRand(x, z, 3) - 0.5) * w * 0.16,
        h + 0.8 + ch1 / 2,
        z + (posRand(x, z, 4) - 0.5) * d * 0.16,
      );
      group.add(tier1);
      if (h > 52) {
        const ch2 = 2.5 + posRand(x, z, 5) * 2.5;
        const tier2 = new THREE.Mesh(GEO.box, mat(shade(roof, 0.6)));
        tier2.scale.set(w * s1 * 0.62, ch2, d * s1 * 0.62);
        tier2.position.set(tier1.position.x, h + 0.8 + ch1 + ch2 / 2, tier1.position.z);
        group.add(tier2);
      }
    }

    // Canopy awning over the ground-floor shopfront on the street face.
    if (posRand(x, z, 6) < 0.8) {
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
    }

    // One painted sign board per building on the outward (street) face —
    // same warm-paint kit as the deco districts, never neon.
    const faceLen = nz !== 0 ? w : d;
    const sw = Math.min(4.5 + posRand(x, z, 7) * 3, faceLen - 2);
    const sign = signBoard(SIGN_WORDS[Math.floor(posRand(x, z, 8) * SIGN_WORDS.length)], sw);
    const so = (posRand(x, z, 9) - 0.5) * (faceLen - sw) * 0.5;
    const sy = 5.6 + posRand(x, z, 10) * 1.6;
    if (nz !== 0) {
      sign.position.set(x + so, sy, z + nz * (d / 2 + 0.18));
    } else {
      sign.rotation.y = Math.PI / 2;
      sign.position.set(x + nx * (w / 2 + 0.18), sy, z + so);
    }
    group.add(sign);
    return mesh;
  }

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

/** Build a full city block: a ring of buildings around a leafy court.
 *  Returns the block's building records ({x,z,w,d,h,nx,nz}) so buildNeon
 *  can anchor signs to real facades; footprints also feed propSolids. */
function buildBlock(group, district, rng, bx, bz) {
  const lot = WORLD.block;
  const inset = 2;
  const recs = [];
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
      buildBuilding(group, district, rng, bx + f.x + px, bz + f.z + pz, pw, pd, f.nx, f.nz, recs);
    }
  }
  for (const r of recs) propSolids.push(r);
  // Dress the courtyard — except Dockside, whose court is already filled
  // by the warehouse and container yard (a cluster there would sit inside
  // the solids).
  if (district.name !== 'Dockside') dressCourtyard(group, bx, bz);
  return recs;
}

/** One leafy cluster per courtyard: a palm, two planters and a bench, all
 *  from the existing boardwalk/palm kit (makePalm + pot/shrub + bench box).
 *  The building ring's inner faces sit ~9m from the block centre, so the
 *  cluster stays inside ~5.5m — clear of the ring and of the roads. The
 *  palm's lean/fronds come from a position-hashed stream (posRng), so no
 *  draws are spent on the shared seed chain. */
function dressCourtyard(group, bx, bz) {
  const crng = posRng(bx, bz);
  const palm = makePalm(crng, PALM_TRUNK, PALM_FROND, 3.6 + crng() * 1.6);
  palm.position.set(bx + (crng() - 0.5) * 4, 0, bz + (crng() - 0.5) * 4);
  group.add(palm);
  queuePalmSway(palm);
  for (const [ox, oz] of [[-3.2, 2.6], [3.1, -2.5]]) {
    const pot = new THREE.Mesh(GEO.box, POT_MAT);
    pot.scale.set(1.4, 0.7, 1.4);
    pot.position.set(bx + ox, 0.35, bz + oz);
    group.add(pot);
    const shrub = new THREE.Mesh(GEO.sphere, SHRUB_MAT);
    shrub.scale.set(1.3, 0.9, 1.3);
    shrub.position.set(bx + ox, 1.0, bz + oz);
    group.add(shrub);
  }
  const bench = new THREE.Mesh(GEO.box, BENCH_MAT);
  bench.scale.set(1.8, 0.5, 0.7);
  bench.position.set(bx + (crng() - 0.5) * 2, 0.25, bz + 4.3);
  bench.rotation.y = (crng() - 0.5) * 0.5;
  group.add(bench);
}

/** Downtown neon signs: emissive boxes anchored ON the lower street-facing
 *  facades of the block's buildings — slightly proud of the wall, never
 *  floating mid-courtyard. The original rng draws are kept in the same
 *  order; the drawn x/z now select which building and where along its
 *  street face instead of a free-floating point inside the block. */
function buildNeon(group, rng, bx, bz, recs) {
  const colours = [0xff3b6b, 0x3bf2ff, 0xffd23b, 0x8bff5a, 0xff8b3b];
  const count = 4 + randInt(rng, 0, 4);
  for (let i = 0; i < count; i += 1) {
    const sign = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: pick(rng, colours) }));
    const sw = 6 + rand(rng, 0, 8);
    const sh = 2 + rand(rng, 0, 2);
    const rx = rand(rng, -18, 18);
    const sy = 10 + rand(rng, 0, 12);
    const rz = rand(rng, -18, 18);
    sign.scale.set(sw, sh, 0.4);
    const b = recs && recs.length
      ? recs[Math.min(recs.length - 1, Math.floor(((rx + 18) / 36) * recs.length))]
      : null;
    if (!b) {
      // No facade records (shouldn't happen): keep the legacy placement.
      sign.position.set(bx + rx, sy, bz + rz);
      group.add(sign);
      continue;
    }
    // Face-centre math from the building's outward normal: sit the sign
    // 0.25m proud of the wall, centred along the face within its width.
    const faceLen = b.nz !== 0 ? b.w : b.d;
    const off = ((rz + 18) / 36 - 0.5) * Math.max(0, faceLen - sw - 1);
    const y = Math.min(sy, b.h - sh / 2 - 1);
    if (b.nz !== 0) {
      sign.position.set(b.x + off, y, b.z + b.nz * (b.d / 2 + 0.25));
    } else {
      sign.rotation.y = Math.PI / 2;
      sign.position.set(b.x + b.nx * (b.w / 2 + 0.25), y, b.z + off);
    }
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
  propSolids.push({ x: bx + 8, z: bz - 6, w: 46, d: 26 }); // warehouse footprint

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
  propSolids.push({ x: bx + 1, z: bz + 18, w: 52, d: 24 }); // container yard footprint

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

/** Nearest road-grid line to a coordinate (read-only mirror of the grid
 *  math in catalog.js — the grid itself is never modified). */
function nearestRoadLine(v) {
  const step = WORLD.block + WORLD.road;
  const i = Math.max(0, Math.min(WORLD.blocks, Math.round((v - westEdge()) / step)));
  return westEdge() + i * step;
}

/** Snap a seeded point onto the road grid with the catalog's snapToRoad,
 *  then push it out past the kerb onto the sidewalk strip (kerb at 7m from
 *  the road centre, building faces at ~12.4m, so 9m sits on the walk). If a
 *  solid footprint (Dockside warehouse/yard can reach the kerb) covers the
 *  spot, slide along the road until clear. Deterministic — the caller's
 *  rng draws are untouched; this only repositions their result. */
function sidewalkSpot(x, z) {
  const p = snapToRoad(x, z);
  const kerb = WORLD.road / 2;
  const walk = kerb + 2;
  const lx = nearestRoadLine(p.x);
  const lz = nearestRoadLine(p.z);
  const onX = Math.abs(p.x - lx) <= kerb; // x on a N-S road → slide along z
  const onZ = Math.abs(p.z - lz) <= kerb;
  if (onX) p.x = lx + (p.x < lx ? -walk : walk);
  if (onZ) p.z = lz + (p.z < lz ? -walk : walk);
  const r = 1.1; // prop half-extent margin
  const hit = (px, pz) => propSolids.some((s) =>
    Math.abs(px - s.x) < s.w / 2 + r && Math.abs(pz - s.z) < s.d / 2 + r);
  if (hit(p.x, p.z)) {
    const base = onX ? p.z : p.x;
    const limit = WORLD.total / 2 - 2;
    // Fine 4m steps: adjacent Dockside yards can tile the walk, leaving
    // only narrow gaps between them (and between the cross-road guards).
    for (const step of [4, -4, 8, -8, 12, -12, 16, -16, 20, -20, 24, -24, 28, -28, 32, -32, 36, -36]) {
      const v = base + step;
      if (Math.abs(v) > limit) continue;
      // Never slide into a cross-road's drive lanes at an intersection.
      if (Math.abs(v - nearestRoadLine(v)) <= kerb + 0.5) continue;
      const px = onX ? p.x : v;
      const pz = onX ? v : p.z;
      if (!hit(px, pz)) { p.x = px; p.z = pz; break; }
    }
  }
  return p;
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

  // Fire hydrants, benches and traffic lights: the same 26 seeded points as
  // before (draws kept in order), snapped onto the road grid and nudged out
  // to the sidewalk strip — never inside a building block or a courtyard.
  for (let i = 0; i < 26; i += 1) {
    const kind = rng();
    const x = rand(rng, -WORLD.total / 2, WORLD.total / 2);
    const z = rand(rng, -WORLD.total / 2, WORLD.total / 2);
    const p = sidewalkSpot(x, z);
    if (kind < 0.4) {
      const h = new THREE.Mesh(GEO.cylinder, mat(0xd2473b));
      h.scale.set(0.18, 0.6, 0.18);
      h.position.set(p.x, 0.3, p.z);
      group.add(h);
    } else if (kind < 0.7) {
      const b = new THREE.Mesh(GEO.box, BENCH_MAT);
      b.scale.set(1.8, 0.5, 0.7);
      b.position.set(p.x, 0.25, p.z);
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
      t.position.set(p.x, 0, p.z);
      group.add(t);
      queueLamp(bulb.material, 0.6, p.x, p.z);
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
  propSolids = [];

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
      const recs = buildBlock(group, d, rng, b.cx, b.cz);
      if (d.name === 'Downtown') buildNeon(group, rng, b.cx, b.cz, recs);
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