// A small seeded random number generator (mulberry32): the same seed gives the
// same city and the same events, which is what makes scenes reproducible.

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Float between min and max. */
export function rand(rng, min, max) {
  return min + (max - min) * rng();
}

/** Uniform integer in [min, max], both inclusive. */
export function randInt(rng, min, max) {
  return Math.floor(rand(rng, min, max + 1));
}

/** Pick one element from an array. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Shuffle an array in place, returns the same array. */
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Deterministically turn any string into a 32-bit integer seed (FNV-1a). */
export function seedFromString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** True with the given probability, so code can read naturally: if (roll(rng, 0.4)). */
export function roll(rng, chance) {
  return rng() < chance;
}

/** Draw n fresh [0,1) values into an array without disturbing the caller's order. */
export function range(rng, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = rng();
  return out;
}