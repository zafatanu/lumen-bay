// LUMEN BAY wanted system: a 0-5 star heat meter that drives the police.
// Heat climbs from crimes (stealing, shooting, hitting pedestrians) and fades
// once the player escapes every unit; at zero heat the stars clear. Heat also
// fades slowly over time even while wanted, so a patient Rook can wait it out. The
// controller owns the numeric state (stars, heat) and a small feed of nearby
// units the HUD can read; the actual police units live in units.js.

/** Heat added by a single crime. */
const CRIME_HEAT = {
  steal: 22,
  shoot: 18,
  pedestrian: 14,
  speeding: 0.4, // per second near a cop
};

/** Threshold heat that crosses into each wanted star (index = star level). */
const STAR_HEAT = [0, 14, 40, 74, 120, 180];

/** Seconds of total escape before heat starts to drain. */
const ESCAPE_DELAY = { foot: 8, car: 12 };

/** Longest a player can hide (no unit in sight) before a search starts. */
const SEARCH_HIDE = 3;

/**
 * Build the wanted controller. `state` is the shared game state; the controller
 * writes stars/heat/lastSeenPos/escapes/bustedCount onto it and keeps a
 * state.policeFeed array of the units the HUD lists.
 */
export function createWanted(state) {
  state.stars = 0;
  state.heat = 0;
  state.escapes = 0;
  state.bustedCount = 0;
  state.lastSeenPos = null;
  state.searching = false;
  state.policeFeed = [];

  /** Raise (or lower) the star count, clamped to 0..5. */
  function setStars(n) {
    state.stars = Math.max(0, Math.min(STAR_HEAT.length - 1, n));
  }

  /** Add heat from a crime; tallies a star when a threshold is crossed. */
  function addHeat(amount, reason) {
    state.heat = Math.max(0, Math.min(199, state.heat + amount));
    for (let i = STAR_HEAT.length - 1; i >= 1; i -= 1) {
      if (state.heat >= STAR_HEAT[i]) {
        setStars(i);
        break;
      }
    }
    return state.stars;
  }

  /** Advance the escape timer and decay heat when every unit has lost Rook. */
  function update(dt, seen, speed, heatBoost) {
    // Heat still climbs while a cop keeps eyes on Rook (speeding near a cop).
    if (heatBoost) addHeat(heatBoost * dt, 'speeding');

    if (state.stars <= 0) {
      state.heat = Math.max(0, state.heat - dt * 2);
      state.searching = false;
      return;
    }

    if (seen) {
      // A unit has line-of-sight: reset the escape window and update last-seen.
      state.escapeTimer = ESCAPE_DELAY[state.inCar ? 'car' : 'foot'];
      if (state.lastSeenPos) state.lastSeenPos.set(seen.x, 0, seen.z);
      else state.lastSeenPos = { x: seen.x, z: seen.z };
      state.searching = false;
      state.hideTimer = 0;
      return;
    }

    // Not seen. Once hidden for a few seconds the search begins; after the
    // escape window, heat drains. At zero heat the stars clear and we escaped.
    state.hideTimer = (state.hideTimer || 0) + dt;
    if (state.hideTimer >= SEARCH_HIDE && state.stars >= 3) {
      state.searching = true;
    }
    state.escapeTimer = (state.escapeTimer || ESCAPE_DELAY[state.inCar ? 'car' : 'foot']) - dt;
    if (state.escapeTimer <= 0) {
      state.heat = Math.max(0, state.heat - dt * 6);
      if (state.heat <= 0) {
        state.stars = 0;
        state.searching = false;
        state.escapes += 1;
        state.lastSeenPos = null;
      }
    }
  }

  /** Called by units.js when a cop grabs Rook; returns true when it busts. */
  function bust() {
    state.bustedCount += 1;
    state.stars = 0;
    state.heat = 0;
    state.searching = false;
    state.escapeTimer = 0;
    state.hideTimer = 0;
    state.policeFeed = [];
    return true;
  }

  return {
    get stars() { return state.stars; },
    get heat() { return state.heat; },
    get escaped() { return state.escapes; },
    get busted() { return state.bustedCount; },
    addHeat,
    setStars,
    update,
    bust,
    searching: () => state.searching,
  };
}