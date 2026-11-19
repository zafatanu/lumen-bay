// LUMEN BAY enemies: The Gulls crew, Lumen Bay PD cops on foot and Old
// Quarter thugs. Each idles near home until Rook works the neighbourhood
// over, then closes down the road grid, stops at a firing distance and trades
// shots until badly hurt or dropped. A hurt gull runs off; cops stand.
// Movement and fire are pure data: combat.js and main.js decide the hits.
// Every enemy walks the same road grid as Rook, so cover reads as fair.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { rand } from '../random.js';

const WEST = -WORLD.total / 2;
const STEP = WORLD.block + WORLD.road;
const HALF = WORLD.road / 2;   // kerb to road centreline, metres
const MARKER_Y = 2.45;        // hostile diamond rest height over the feet
const FALL_TIME = 0.7;        // seconds to topple on death
const FADE_TIME = 0.6;        // seconds to fade after toppling
const SPAWN_SPREAD = 24;      // random radius for mission spawns

/** Centreline of road lane i (0..WORLD.blocks). */
function roadLine(i) {
  return WEST + i * STEP;
}

/** Centreline of whichever lane runs nearest to v. */
function nearestLine(v) {
  const i = Math.round((v - WEST) / STEP);
  return roadLine(Math.max(0, Math.min(WORLD.blocks, i)));
}

/** Distance from `to` to the nearest road centreline, XZ plane. A figure is
 *  judged against the lanes, never its start point. */
export function roadClearance(to) {
  return Math.hypot(to.x - nearestLine(to.x), to.z - nearestLine(to.z));
}

/**
 * Nudge a point back onto the street grid when it has wandered into a block.
 * Figures cannot walk through buildings, so keep them to the lanes.
 */
export function keepOnRoads(p) {
  const lx = nearestLine(p.x);
  const lz = nearestLine(p.z);
  const inX = Math.abs(p.x - lx) <= HALF - 0.3;
  const inZ = Math.abs(p.z - lz) <= HALF - 0.3;
  if (inX || inZ) return;
  const dx = Math.abs(p.x - lx);
  const dz = Math.abs(p.z - lz);
  if (dx <= dz) p.x = lx + Math.sign(p.x - lx) * (HALF - 0.3);
  else p.z = lz + Math.sign(p.z - lz) * (HALF - 0.3);
}

/** Plain XZ distance between two {x,z} points. */
export function flatDist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Turn an angle from `from` toward `to` by at most `step` rad, short way round. */
export function turnTo(from, to, step) {
  let d = ((to - from + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  if (Math.abs(d) <= step) return to;
  return from + Math.sign(d) * step;
}

/** A ring of road points around `centre`, for spawning a small crew. */
export function roadRingAround(centre, radius, count) {
  const out = [];
  const lx = nearestLine(centre.x);
  const lz = nearestLine(centre.z);
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + radius * 0.7;
    out.push({ x: lx + Math.sin(a) * radius, z: lz + Math.cos(a) * radius });
  }
  return out;
}

/**
 * Per-kind temperament of the three hostile crews.
 * alertRadius: how close Rook walks before they clock him.
 * range: the distance they stop at and start shooting from.
 * fireRange: the furthest they will try a shot at all.
 * spread: lateral miss in radians per 10m of range.
 * flees: drop their guns and run once badly hurt.
 */
export const KINDS = {
  gull: {
    label: 'Gull', jacket: 0xc0392b, trim: 0x3a1d18, legs: 0x2a3138,
    skin: 0xe6b98f, hat: 0xa32d22,
    alertRadius: 15, range: 7, fireRange: 18,
    speed: 5.1, fireInterval: 1.0, damage: 7, spread: 0.035,
    loot: [80, 160], flees: true,
  },
  cop: {
    label: 'LBPD', jacket: 0x2a3a6b, trim: 0xd8d2b0, legs: 0x1d2742,
    skin: 0xc68f63, hat: 0x19233f,
    alertRadius: 17, range: 11, fireRange: 24,
    speed: 4.8, fireInterval: 1.1, damage: 9, spread: 0.025,
    loot: [120, 220], flees: false,
  },
  thug: {
    label: 'Thug', jacket: 0x55603a, trim: 0x22251f, legs: 0x31362a,
    skin: 0x8d6547, hat: 0x22251f,
    alertRadius: 13, range: 6, fireRange: 15,
    speed: 5.5, fireInterval: 0.85, damage: 6, spread: 0.05,
    loot: [60, 140], flees: false,
  },
};

/** What a punch lands for when anyone brawls up close, in hp. */
export const MELEE_DAMAGE = 14;

/** A hostile low-poly figure: jacket + trim, legs, head, optional hat. */
function buildEnemyMesh(kind) {
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: kind.jacket, roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: kind.trim, roughness: 0.9 });
  const legs = new THREE.MeshStandardMaterial({ color: kind.legs, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: kind.skin, roughness: 0.85 });
  const hat = new THREE.MeshStandardMaterial({ color: kind.hat, roughness: 0.85 });

  const legGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.72, 6);
  for (const lx of [0.16, -0.16]) {
    const leg = new THREE.Mesh(legGeo, legs);
    leg.position.set(lx, 0.36, 0);
    group.add(leg);
  }
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.72, 8), jacket);
  body.position.y = 0.98;
  group.add(body);
  const trimBand = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.12, 8), trim);
  trimBand.position.y = 1.28;
  group.add(trimBand);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), skin);
  head.position.y = 1.6;
  group.add(head);
  if (kind.hat !== undefined) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 8), hat);
    cap.position.y = 1.82;
    group.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.28), hat);
    brim.position.set(0, 1.78, 0.15);
    group.add(brim);
  }
  return group;
}

/** The floating hostile diamond marker that hangs over a live enemy. */
function buildMarker() {
  const diamond = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.56, 4),
    new THREE.MeshBasicMaterial({ color: 0xff2b2b, transparent: true, opacity: 0.95 })
  );
  diamond.rotation.y = Math.PI / 4;
  return diamond;
}

/**
 * Make one live enemy from a kind + spawn point. The group holds the figure
 * and the hostile marker; state lives on the returned enemy object.
 */
function makeEnemy(kind, spawn, scene, rng) {
  const k = KINDS[kind] || KINDS.thug;
  const mesh = buildEnemyMesh(k);
  const marker = buildMarker();
  const group = new THREE.Group();
  group.add(mesh);
  group.add(marker);
  group.position.copy(spawn);
  const pos = group.position.clone();
  const enemy = {
    kind,
    def: k,
    mesh: group,
    fig: mesh,
    marker,
    pos,
    heading: rand(rng, 0, Math.PI * 2),
    home: spawn.clone(),
    alive: true,
    health: 100,
    state: 'idle',
    fireTimer: rand(rng, 0.4, 1.4),
    fall: 0,
    fade: 0,
    money: Math.round(k.loot[0] + (k.loot[1] - k.loot[0]) * rng()),
  };
  scene.add(group);
  return enemy;
}

/**
 * Shared enemy controller. Returns the { spawnEnemy, update, list, clear }
 * surface the combat module drives; each entry in `list` is an enemy made
 * by makeEnemy with its own mesh, marker, health and AI state.
 */
export function createEnemies(scene, city, rng) {
  const list = [];

  /** Place one enemy of a kind at (or near) a world point. */
  function spawnEnemy(kind, pos, opts = {}) {
    const p = new THREE.Vector3(pos.x, 0, pos.z);
    keepOnRoads(p);
    const e = makeEnemy(kind, p, scene, rng);
    if (opts.health) e.health = opts.health;
    if (opts.aggressive) e.state = 'chase';
    if (opts.kind) e.kind = opts.kind;
    list.push(e);
    return e;
  }

  /** Apply damage to an enemy; a hit to 0 starts the fall + fade death. */
  function damage(e, dmg, from) {
    if (!e || !e.alive) return;
    e.health = Math.max(0, e.health - dmg);
    if (e.health <= 0) {
      e.alive = false;
      e.fall = FALL_TIME;
      e.fade = FADE_TIME;
    }
  }

  /** Remove every enemy mesh from the scene and empty the list. */
  function clear() {
    for (const e of list) {
      scene.remove(e.mesh);
    }
    list.length = 0;
  }

  /** Move every live enemy and collect the shots they fire this step.
   *  Dead ones topple, fade and drop out of `list`. Returns `shots`, an array
   *  of { origin, dir, damage, from } for combat.js to resolve vs the player. */
  function update(dt, playerPos, playerInCar) {
    const shots = [];
    const live = [];
    for (const e of list) {
      if (!e.alive) {
        if (e.fall > 0) {
          e.fall -= dt;
          const t = 1 - e.fall / FALL_TIME;
          e.mesh.rotation.x = Math.min(Math.PI / 2, t * Math.PI / 2);
          e.mesh.position.y = -Math.sin(Math.min(Math.PI / 2, t * Math.PI / 2)) * 0.7;
        } else if (e.mesh.visible) {
          e.fade -= dt;
          e.marker.visible = false;
          const o = Math.max(0, Math.min(1, e.fade / FADE_TIME));
          e.fig.traverse((child) => {
            if (child.isMesh) {
              child.material.transparent = true;
              child.material.opacity = o;
            }
          });
          if (e.fade <= 0) {
            scene.remove(e.mesh);
            e.mesh.visible = false;
          }
        }
        if (e.mesh.visible) live.push(e);
        continue;
      }
      live.push(e);
      const dx = playerPos.x - e.pos.x;
      const dz = playerPos.z - e.pos.z;
      const dist = Math.hypot(dx, dz);
      e.fireTimer -= dt;

      // --- Decide the AI state. A hurt, fleet-footed crew runs; cops hold. ---
      if (e.health <= 40 && e.def.flees) {
        e.state = 'flee';
      } else if (dist <= e.def.alertRadius && !playerInCar) {
        e.state = dist <= e.def.range ? 'shoot' : 'chase';
      } else if (e.state === 'shoot' || e.state === 'chase') {
        if (playerInCar || dist > e.def.alertRadius * 2.5) e.state = 'idle';
        else e.state = dist <= e.def.range ? 'shoot' : 'chase';
      }

      const toward = Math.atan2(dx, dz);
      let speed = 0;
      if (e.state === 'flee') {
        e.heading = turnTo(e.heading, toward + Math.PI, dt * 2.5);
        speed = e.def.speed;
      } else if (e.state === 'chase') {
        e.heading = turnTo(e.heading, toward, dt * 4);
        speed = dist > e.def.range ? e.def.speed : 0;
      } else if (e.state === 'shoot') {
        e.heading = turnTo(e.heading, toward, dt * 6);
        if (dist < e.def.range * 0.7) {
          e.heading = turnTo(e.heading, toward + Math.PI, dt * 4);
          speed = e.def.speed * 0.5;
        }
        if (e.fireTimer <= 0 && dist <= e.def.fireRange) {
          e.fireTimer = e.def.fireInterval;
          const o = e.pos.clone();
          o.y = 1.1;
          const miss = (Math.random() - 0.5) * e.def.spread * 10 * Math.max(1, dist / 10);
          const aimAng = toward + miss;
          const dvec = new THREE.Vector3(Math.sin(aimAng), 0, Math.cos(aimAng));
          shots.push({ origin: o, dir: dvec, damage: e.def.damage, from: e });
        }
      }

      if (speed > 0) {
        e.pos.x += Math.sin(e.heading) * speed * dt;
        e.pos.z += Math.cos(e.heading) * speed * dt;
        keepOnRoads(e.pos);
      }
      e.mesh.position.copy(e.pos);
      e.mesh.rotation.y = e.heading;
      e.mesh.rotation.x = 0;
      e.mesh.position.y = 0;
      e.marker.position.set(0, MARKER_Y, 0);
    }

    list.length = 0;
    for (const el of live) list.push(el);
    return shots;
  }

  return { spawnEnemy, update, list, clear, damage };
}

