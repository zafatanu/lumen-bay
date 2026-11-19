// LUMEN BAY — all tuning numbers and colours in one place.
// The city is a fixed 8x8 block grid; the renderer scales to the window.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display rate. */
export const STEP = 1 / 60;

/** World grid: 8x8 city blocks, each 60m of building lot, 14m of road between. */
export const WORLD = {
  blocks: 8,
  block: 60,
  road: 14,
  total: 8 * 60 + 7 * 14, // 578m across the whole island
};

/** Coastal boardwalk lies along the west (x-negative) edge. */
export const COAST = {
  boulevardWidth: 12,
  beachWidth: 34,
  boardwalkWidth: 8,
  boardwalkPlank: 3,
};

/** The open sea and the sand strip beyond the beach. */
export const SEA = {
  level: -1.5,     // ocean surface sits a little below the road plane
  sandLevel: -0.9, // beach rises slightly above the water
  extent: 260,     // how far west the water plane reaches past the coast
};

/** The five original districts. centre is {x,z} world coords of the district hub.
 *  Each palette colours its buildings; the whole set is handed to the city so
 *  district identity reads clearly on the map screen and in the street. */
export const DISTRICTS = [
  { name: 'Coral Beach', centre: { x: -230, z: -230 }, palette: ['#ffd9e6', '#ffe3c4', '#ffc9a3', '#f7d7b5'], minH: 12, maxH: 26 },
  { name: 'Downtown',    centre: { x: 40,  z: 40  }, palette: ['#b8c6ff', '#c9b6ff', '#9fb8ff', '#b3a8ff'], minH: 30, maxH: 60 },
  { name: 'Old Quarter', centre: { x: -40, z: 210 }, palette: ['#f2d7a0', '#e8c488', '#f0c87f', '#e6b678'], minH: 9,  maxH: 16 },
  { name: 'Dockside',    centre: { x: 230, z: -40 }, palette: ['#9aa3ae', '#aeb3bb', '#88909a', '#b7bcc2'], minH: 10, maxH: 24 },
  { name: 'Marina',      centre: { x: 210, z: 230 }, palette: ['#a8e6ff', '#9fd8f0', '#b5e9f7', '#a3e0ef'], minH: 10, maxH: 22 },
];

/** Sunset palette and the day/time cycle. Day 1 clock starts at 17:40 (sunset). */
export const DAY = {
  days: 3,
  startMinutes: 17 * 60 + 40, // 17:40
  minutesPerDay: 24 * 60,
  clockSpeed: 1, // real seconds per game minute (slowed for pace; tune later)
};

export const SUNSET = {
  fog: 0xca8bb0,
  skyTop: 0x2a1b55,
  skyMid: 0xff7a6a,
  skyLow: 0xffc27a,
  sun: 0xffd19a,
  sunIntensity: 1.6,
  ambient: 0xffa76a,
  hemiSky: 0xff9d8a,
  hemiGround: 0x3a2a4a,
  nightSky: 0x14143a,
  nightSunIntensity: 0.15,
};

/** Player on foot. */
export const PLAYER = {
  walk: 4.2,
  run: 8.0,
  height: 1.7,
  health: 100,
  armour: 0,
  reach: 2.2,
};

/** Cars. */
export const CAR = {
  accel: 26,
  topSpeed: 42,
  reverse: -14,
  braking: 40,
  handling: 1.9,
  turnSpeed: 1.6,
  nitroBoost: 1.9,
  nitroMax: 30,
};

/** Police wanted stars. */
export const POLICE = {
  stars: [10, 30, 60, 100, 160, 240], // xp needed to cross each star boundary
  heatPerStar: 0.5,
  escapeWindow: 20,
};

/** Starting bank and rank. */
export const MONEY_START = 2400;
export const REP_START = 1;
export const REP_NAME = 'BAY ROOKIE';

/** Number of collectible conch shells scattered around the island. */
export const COLLECTIBLES = 24;

/** Where the save is kept between visits (this browser only). */
export const SAVE_KEY = 'lumen-bay-save-v1';

/** Default scene seed when the URL gives none; a fixed value keeps the demo reproducible. */
export const SEED = 20261117;

/** Player spawn point on the boulevard near Coral Beach (world coords). */
export const SPAWN = { x: -120, z: -80 };

/** Chase camera: orbit distance, height and how fast the intro glide settles. */
export const CAMERA = {
  distStart: 55,
  distMax: 16,     // extra distance added once the glide finishes
  heightStart: 26,
  heightMax: 18,   // camera lifts this much as the intro plays out
  glide: 0.6,      // how fast the camera drifts in (0..1 per second)
  orbitSpeed: 0.05, // radians of orbit drift per second
  lookHeight: 2,   // y target the camera stares at on the player
};