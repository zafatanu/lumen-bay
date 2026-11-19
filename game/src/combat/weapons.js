// LUMEN BAY weapon catalog: the four things Rook carries. Fists are always
// there; the three firearms unlock as REP climbs. This module owns only
// ammo, fire rate and reloading; whether a shot lands is combat.js's call.
// Slots stay in hotbar order so HUD key 1-4 lines up with arsenal.select().
import * as THREE from 'three';

/** Weapon definitions, in hotbar order (keys 1-4). */
export const WEAPONS = [
  {
    index: 1, id: 'fists', name: 'Fists', short: 'FISTS',
    melee: true, damage: 34, fireRate: 2.8, range: 2.1,
    mag: Infinity, reserve: Infinity, reloadTime: 0, rep: 0,
    spread: 0, pellets: 1, colour: 0xd9a87c,
    muzzle: false, tracer: false, auto: false, knock: 0.6,
  },
  {
    index: 2, id: 'pistol', name: 'Luz Pistol', short: 'LUZ',
    melee: false, damage: 26, fireRate: 4.2, range: 60,
    mag: 12, reserve: 96, reloadTime: 0.9, rep: 1,
    spread: 0.012, pellets: 1, colour: 0xbfc7d0,
    muzzle: true, tracer: true, auto: false, knock: 0.5,
  },
  {
    index: 3, id: 'smg', name: 'Tide SMG', short: 'TIDE',
    melee: false, damage: 15, fireRate: 11, range: 45,
    mag: 30, reserve: 180, reloadTime: 1.1, rep: 2,
    spread: 0.03, pellets: 1, colour: 0x8a9aa3,
    muzzle: true, tracer: true, auto: true, knock: 0.2,
  },
  {
    index: 4, id: 'shotgun', name: 'Breaker Shotgun', short: 'BREAKER',
    melee: false, damage: 9, fireRate: 1.5, range: 22,
    mag: 6, reserve: 36, reloadTime: 1.6, rep: 3,
    spread: 0.085, pellets: 8, colour: 0x6b4a2f,
    muzzle: true, tracer: true, auto: false, knock: 1.4,
  },
];

/** Catalog lookup by 0-based slot (the numbers the input layer hands us). */
export function weaponAt(slot) {
  return WEAPONS[slot] || null;
}

/** Catalog lookup by id ('pistol', 'fists', ...). */
export function weaponById(id) {
  for (const w of WEAPONS) if (w.id === id) return w;
  return null;
}

/** The full trigger-pull's worth of damage; a shotgun counts every pellet.
 *  A pistol or SMG fires a single pellet, so its value is unchanged. */
export function burstDamage(w) {
  if (!w) return 0;
  if (w.id === 'shotgun') return w.damage * w.pellets;
  return w.damage;
}

/** A tiny low-poly gun for Rook's right hand, parented at the hip so it sits
 *  in the palm; the barrel points along +Z before the hand rotation. */
export function buildGunMesh(id) {
  const gun = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.35 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.85 });

  if (id === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.44), dark);
    slide.position.set(0, 0.06, 0.1);
    gun.add(slide);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.26, 0.13), grip);
    handle.position.set(0, -0.08, -0.06);
    handle.rotation.x = -0.22;
    gun.add(handle);
  } else if (id === 'smg') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.62), dark);
    body.position.set(0, 0, 0.15);
    gun.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, 0.58);
    gun.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.1), dark);
    mag.position.set(0, -0.2, 0.08);
    gun.add(mag);
  } else if (id === 'shotgun') {
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.4), grip);
    stock.position.set(0, -0.02, -0.34);
    gun.add(stock);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.92, 6), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.05, 0.26);
    gun.add(barrel);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.26), grip);
    pump.position.set(0, -0.03, 0.36);
    gun.add(pump);
  }
  return gun;
}

/** Hotbar strip text, e.g. "1 FISTS · 2 LUZ · 3 TIDE · 4 BREAK". */
export function weaponStrip(arsenal) {
  const parts = [];
  for (const w of WEAPONS) {
    parts.push(`${w.index} ${arsenal.ammoFor(w.id).locked ? 'LOCK' : w.short}`);
  }
  return parts.join(' · ');
}

/** Rank title for the next weapon still under REP lock, or '' once all are open. */
export function nextUnlock(state) {
  for (const w of WEAPONS) {
    if (!w.melee && (state.rep || 0) < w.rep) return `${w.name} unlocks at REP ${w.rep}`;
  }
  return '';
}

/** Build the arsenal: which gun Rook holds, its live magazine and its reserves.
 *  Ammo lives on `state.ammo` ({ id: { mag, reserve } }) so save()/load() keep it.
 *  Returns { current, select(i), tryFire(), reload(), update(dt), ammoFor(id) }. */
export function createArsenal(state) {
  if (!state.ammo || typeof state.ammo !== 'object') {
    state.ammo = {};
    for (const w of WEAPONS) {
      if (Number.isFinite(w.mag)) state.ammo[w.id] = { mag: w.mag, reserve: w.reserve };
      else state.ammo[w.id] = { mag: Infinity, reserve: Infinity };
    }
  }

  let current = 'fists';
  let cooldown = 0;    // seconds until the next trigger pull
  let reloadT = 0;     // seconds left on the reload, 0 when idle

  function def() {
    return weaponById(current) || WEAPONS[0];
  }

  function pocket(w) {
    return state.ammo[w.id] || (state.ammo[w.id] = { mag: w.mag, reserve: w.reserve });
  }

  function isLocked(w) {
    return !!w && !w.melee && (state.rep || 0) < w.rep;
  }

  function select(slot) {
    const w = weaponAt(slot);
    if (!w || isLocked(w)) return null;
    current = w.id;
    cooldown = 0;
    reloadT = 0;
    return w;
  }

  /** Start a 1.2s reload if it makes sense to: a gun, not mid-reload, some reserve left. */
  function reload() {
    const w = def();
    if (w.melee || reloadT > 0) return false;
    const p = pocket(w);
    if (p.mag >= w.mag || p.reserve <= 0) return false;
    reloadT = w.reloadTime;
    return true;
  }

  /** Advance the cooldown and finish a reload when its timer runs out. */
  function update(dt) {
    if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);
    if (reloadT > 0) {
      reloadT = Math.max(0, reloadT - dt);
      if (reloadT === 0) {
        const w = def();
        if (!w.melee) {
          const p = pocket(w);
          const need = Math.max(0, w.mag - p.mag);
          const take = Math.min(need, p.reserve);
          p.mag += take;
          p.reserve -= take;
        }
      }
    }
  }

  /** Pull the trigger. Returns null (blocked, or nothing to shoot) or a shot
   *  descriptor { hit, damage, muzzle }: `hit` starts false and combat.js sets
   *  it once it knows the ray connected. */
  function tryFire() {
    const w = def();
    if (cooldown > 0 || reloadT > 0) return null;
    if (w.melee) {
      cooldown = 1 / w.fireRate;
      return {
        hit: false, damage: w.damage, muzzle: false,
        weapon: w, pellets: 1, spread: 0, knock: w.knock,
      };
    }
    const p = pocket(w);
    if (!Number.isFinite(p.mag)) p.mag = w.mag;
    if (p.mag <= 0) {
      reload();
      return null;
    }
    p.mag -= 1;
    cooldown = 1 / w.fireRate;
    return {
      hit: false, damage: w.damage, muzzle: w.muzzle,
      weapon: w, pellets: w.pellets, spread: w.spread, knock: w.knock,
    };
  }

  /** Ammo readout for one weapon id: { mag, reserve, magSize, locked }. */
  function ammoFor(id) {
    const w = weaponById(id);
    if (!w) return { mag: 0, reserve: 0, magSize: 0, locked: true };
    const p = pocket(w);
    return { mag: p.mag, reserve: p.reserve, magSize: w.mag, locked: isLocked(w) };
  }

  /** Top up a weapon's reserve (pickups, missions, respawn). */
  function addAmmo(id, rounds) {
    const w = weaponById(id);
    if (!w || w.melee) return 0;
    const p = pocket(w);
    p.reserve = Math.min(w.reserve, p.reserve + Math.max(0, Math.round(rounds)));
    return p.reserve;
  }

  /** Refill every gun and drop back to the pistol, for a respawn. */
  function refillAll() {
    for (const w of WEAPONS) {
      if (w.melee) continue;
      const p = pocket(w);
      p.mag = w.mag;
      p.reserve = w.reserve;
    }
    select(1);
    reloadT = 0;
    cooldown = 0;
    return current;
  }

  return {
    select,
    tryFire,
    reload,
    update,
    ammoFor,
    addAmmo,
    refillAll,
    isLocked: (slot) => isLocked(weaponAt(slot)),
    get current() { return def(); },
    get index() { return def().index; },
    get name() { return def().name; },
    get melee() { return !!def().melee; },
    get reloading() { return reloadT > 0; },
    get reloadLeft() { return Math.max(0, reloadT); },
    get cooling() { return cooldown > 0; },
  };
}

