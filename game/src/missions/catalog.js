// LUMEN BAY mission catalog: 8 story chapters, 3 side jobs and the 24
// collectible conch shells, plus the named cast. Pure data, no scene.
// Districts use the config centres: Coral Beach, Downtown, Old Quarter,
// Dockside, Marina. Each mission is a stage list the engine walks in order.

import { DISTRICTS, WORLD } from '../config.js';

/** Reachable road edge offset: road half-width (7) minus the on-foot radius (0.3). */
const SNAP_EDGE = WORLD.road / 2 - 0.3;

/** Road grid line positions: the west coast, then every block+road pitch. */
function roadLine(i) {
  const west = -WORLD.total / 2;
  return west + i * (WORLD.block + WORLD.road);
}

/** Nearest road line to a coordinate, with its signed offset. */
function nearestRoad(v) {
  let best = Infinity;
  let bestI = 0;
  for (let i = 0; i <= WORLD.blocks; i += 1) {
    const r = roadLine(i);
    const d = v - r;
    if (Math.abs(d) < Math.abs(best)) { best = d; bestI = i; }
  }
  return { line: roadLine(bestI), d: best };
}

/**
 * Snap a world point onto the road grid so the on-foot player and cars can
 * actually reach it. Mirrors clampToRoads (on-foot radius 0.3): if the point
 * is already within a road on either axis, keep it; otherwise push the axis
 * that needs the smaller nudge out to the nearer road edge.
 * @param {number} x world x
 * @param {number} z world z
 * @returns {{x:number, z:number}} snapped {x,z}
 */
export function snapToRoad(x, z) {
  const nx = nearestRoad(x);
  const nz = nearestRoad(z);
  if (Math.abs(nx.d) <= SNAP_EDGE) return { x, z };
  if (Math.abs(nz.d) <= SNAP_EDGE) return { x, z };
  const xPush = Math.abs(nx.d) - SNAP_EDGE;
  const zPush = Math.abs(nz.d) - SNAP_EDGE;
  if (xPush <= zPush) return { x: nx.line + Math.sign(nx.d) * SNAP_EDGE, z };
  return { x, z: nz.line + Math.sign(nz.d) * SNAP_EDGE };
}

/** Named cast for the HUD dialogue and portraits. */
export const CHARACTERS = [
  { name: 'Rook', role: 'Getaway Driver', district: 'Coral Beach', colour: '#1fb9a8', bio: 'A quiet wheel behind Lumen Bay\u2019s cleanest getaways.' },
  { name: 'Mama Luz', role: 'Old Quarter Fixer', district: 'Old Quarter', colour: '#8a6b52', bio: 'Runs the stucco cell with two phones and a shawl.' },
  { name: 'Tito', role: 'Dockside Mechanic', district: 'Dockside', colour: '#e0891f', bio: 'Grease-fingered genius who makes stolen rides vanish.' },
  { name: 'Ivy', role: 'Marina Hacker', district: 'Marina', colour: '#9a5bd0', bio: 'Turns traffic lights and ferry lanes against the cops.' },
  { name: 'Captain Solano', role: 'Lumen Bay PD', district: 'Downtown', colour: '#2a3a6b', bio: 'The law with a moustache and a personal grudge.' },
  { name: 'Kestrel', role: 'The Gulls Boss', district: 'Dockside', colour: '#c0392b', bio: 'Feather-capped rival running every crate on the docks.' },
];

/** Story missions: chapter, giver, district, briefing, stages, reward. */
export const MISSIONS = [
  {
    id: 'm1',
    chapter: 1,
    title: 'First Light',
    giver: 'Mama Luz',
    district: 'Old Quarter',
    briefing: 'Rook, the first job is soft. Steal a Bay Runner from the Coral Beach lot and drive it to Mama Luz in the Old Quarter. Keep the paint clean.',
    stages: [
      { text: 'Steal a car on Coral Beach', type: 'go', target: { x: -120, z: -84 }, timerSec: null, enemies: null, wanted: null },
      { text: 'Drive to Mama Luz in the Old Quarter', type: 'drive', target: 'Old Quarter', timerSec: null, enemies: null, wanted: null },
    ],
    reward: { money: 500, repXp: 60 },
    dialogue: [
      { who: 'Mama Luz', line: 'Fresh wheels make fresh fortunes. Bring it to the shutter and I\u2019ll make you known.' },
      { who: 'Rook', line: 'Easy money. I\u2019m already behind the wheel.' },
    ],
  },
  {
    id: 'm2',
    chapter: 2,
    title: 'Hot Wheels',
    giver: 'Tito',
    district: 'Dockside',
    briefing: 'Tito needs a hot sedan delivered to the Dockside bay. The cops clocked it off the lot, so expect a single wanted star the whole way.',
    stages: [
      { text: 'Deliver the sedan to Tito\u2019s Dockside bay', type: 'deliver', target: 'Dockside', timerSec: 150, enemies: null, wanted: 1 },
      { text: 'Shake the single patrol star', type: 'escape', target: null, timerSec: null, enemies: null, wanted: null },
    ],
    reward: { money: 700, repXp: 80 },
    dialogue: [
      { who: 'Tito', line: 'That paint job says hot. Pop the hood, drop it in the bay, and let the cops chase the smell of grease.' },
      { who: 'Rook', line: 'One star, no trouble. Count it already.' },
    ],
  },
  {
    id: 'm3',
    chapter: 3,
    title: 'Dockside Run',
    giver: 'Tito',
    district: 'Dockside',
    briefing: 'The Gulls stashed crates in a Dockside yard. Tito wants them moved before dawn. The crew has the warehouse posted, so bring heat.',
    stages: [
      { text: 'Drive to the Dockside container yard', type: 'drive', target: 'Dockside', timerSec: null, enemies: null, wanted: null },
      { text: 'Clear the Gulls off the crates', type: 'shoot', target: 'Dockside', timerSec: null, enemies: { kind: 'gull', n: 4 }, wanted: null },
      { text: 'Smuggle the crates back to the yard gate', type: 'go', target: { x: 208, z: -22 }, timerSec: null, enemies: null, wanted: null },
    ],
    reward: { money: 900, repXp: 110 },
    dialogue: [
      { who: 'Tito', line: 'The Gulls are squatting on my crates. Move them off and I\u2019ll move the whole crate.' },
      { who: 'Rook', line: 'Four of them? Feels like a warm-up for something bigger.' },
    ],
  },
  {
    id: 'm4',
    chapter: 4,
    title: 'The Getaway',
    giver: 'Ivy',
    district: 'Marina',
    briefing: 'A courier drop went sideways. Ivy needs a driver for the escape route out of Downtown. Three stars plus the helicopter \u2014 don\u2019t stop.',
    stages: [
      { text: 'Reach the Downtown bank job pickup', type: 'drive', target: 'Downtown', timerSec: null, enemies: null, wanted: 0 },
      { text: 'Hold off the police as the crew loads up', type: 'survive', target: 'Downtown', timerSec: 20, enemies: null, wanted: null },
      { text: 'Lose the three-star chase and the heli', type: 'escape', target: null, timerSec: null, enemies: null, wanted: 3 },
    ],
    reward: { money: 1600, repXp: 190 },
    dialogue: [
      { who: 'Ivy', line: 'Bank alarm\u2019s up and Solano wants a parade. Keep moving and don\u2019t get sentimental.' },
      { who: 'Rook', line: 'A helicopter over Lumen Bay. This is getting loud.' },
    ],
  },
  {
    id: 'm5',
    chapter: 5,
    title: 'Neon Reign',
    giver: 'Ivy',
    district: 'Downtown',
    briefing: 'A street-race contract across Downtown\u2019s neon loops, but the Gulls put a runner in the pack. Win the line and drop their shooter before the last bend.',
    stages: [
      { text: 'Reach the neon race start line', type: 'drive', target: 'Downtown', timerSec: null, enemies: null, wanted: null },
      { text: 'Win the Downtown street race', type: 'race', target: 'Downtown', timerSec: null, enemies: null, wanted: null },
      { text: 'Drop the Gulls shooter at the finish', type: 'shoot', target: 'Downtown', timerSec: null, enemies: { kind: 'gull', n: 2 }, wanted: null },
    ],
    reward: { money: 1800, repXp: 210 },
    dialogue: [
      { who: 'Ivy', line: 'Win it clean or win it loud. The Gulls paid for their lane \u2014 take it anyway.' },
      { who: 'Rook', line: 'Neon, a finish line and a shooter. Now that\u2019s a Lumen Bay night.' },
    ],
  },
  {
    id: 'm6',
    chapter: 6,
    title: 'High Tide',
    giver: 'Mama Luz',
    district: 'Marina',
    briefing: 'The Gulls grabbed Ivy off the Marina pier. Mama Luz needs a driver to break the ambush before the tide closes the road. Bring everyone home.',
    stages: [
      { text: 'Reach the Marina pier ambush', type: 'drive', target: 'Marina', timerSec: null, enemies: null, wanted: null },
      { text: 'Clear the Gulls off the pier and free Ivy', type: 'shoot', target: 'Marina', timerSec: null, enemies: { kind: 'gull', n: 3 }, wanted: null },
      { text: 'Escort Ivy out before the tide cuts the road', type: 'go', target: { x: 150, z: 240 }, timerSec: 60, enemies: null, wanted: null },
    ],
    reward: { money: 2100, repXp: 240 },
    dialogue: [
      { who: 'Mama Luz', line: 'They took the hacker. The pier\u2019s a snare \u2014 break it or we lose the whole play.' },
      { who: 'Ivy', line: 'Told you never to let them take me for a swim.' },
    ],
  },
  {
    id: 'm7',
    chapter: 7,
    title: 'Heat Wave',
    giver: 'Ivy',
    district: 'Downtown',
    briefing: 'Solano flipped the whole precinct to manhunt. Four stars, roadblocks on every lane. Outrun the net and lose every car on your tail.',
    stages: [
      { text: 'Run the Downtown manhunt gauntlet', type: 'race', target: 'Downtown', timerSec: null, enemies: null, wanted: 4 },
      { text: 'Lose the four-star net and roadblocks', type: 'escape', target: null, timerSec: null, enemies: null, wanted: null },
    ],
    reward: { money: 2600, repXp: 300 },
    dialogue: [
      { who: 'Ivy', line: 'Four stars and a roadblock on every block. You wanted a legend, Rook \u2014 here it is.' },
      { who: 'Rook', line: 'Outrun a city. Sure. Count me in.' },
    ],
  },
  {
    id: 'm8',
    chapter: 8,
    title: 'Golden Hour',
    giver: 'Mama Luz',
    district: 'Downtown',
    briefing: 'The final score. One last heist, one last chase, and Kestrel waiting on the docks for his crown. Put him down and own the Bay.',
    stages: [
      { text: 'Reach the final Downtown vault job', type: 'drive', target: 'Downtown', timerSec: null, enemies: null, wanted: null },
      { text: 'Hold the vault as the crew clears it', type: 'survive', target: 'Downtown', timerSec: 25, enemies: null, wanted: null },
      { text: 'Bring the score to the Dockside dock', type: 'deliver', target: 'Dockside', timerSec: 180, enemies: null, wanted: 0 },
      { text: 'Put down Kestrel and his crew at the dock', type: 'shoot', target: 'Dockside', timerSec: null, enemies: { kind: 'gull', n: 5 }, wanted: null },
    ],
    reward: { money: 5000, repXp: 500 },
    dialogue: [
      { who: 'Mama Luz', line: 'Everything ends at the dock. Win the hour and the Bay is ours.' },
      { who: 'Kestrel', line: 'Rook. You took my lane. You won\u2019t take the dock.' },
    ],
  },
];

/** Side jobs: taxi fares, taco delivery and the street race. */
export const SIDE_JOBS = [
  {
    id: 'taxi',
    title: 'Taxi Fare',
    district: 'Downtown',
    marker: { x: 48, z: 44 },
    briefing: 'Pick up the fare and drop them at the marker before the meter runs out.',
    stops: [
      { text: 'Pick up the fare at the Downtown cab stand', type: 'go', target: { x: 50, z: 48 }, timerSec: 40 },
      { text: 'Drop the fare at the marker', type: 'deliver', target: 'Marina', timerSec: 60 },
    ],
    payout: 260,
  },
  {
    id: 'taco',
    title: 'Taco Run',
    district: 'Coral Beach',
    marker: { x: -228, z: -228 },
    briefing: 'Three hot stops, one beachfront truck. Move fast and the salsa stays warm.',
    stops: [
      { text: 'Stop one: the boardwalk kiosk', type: 'deliver', target: { x: -270, z: -160 }, timerSec: 45 },
      { text: 'Stop two: the marina stand', type: 'deliver', target: 'Marina', timerSec: 45 },
      { text: 'Stop three: the taco truck', type: 'deliver', target: 'Coral Beach', timerSec: 45 },
    ],
    payout: 320,
  },
  {
    id: 'race',
    title: 'Street Race',
    district: 'Marina',
    marker: { x: 210, z: 232 },
    briefing: 'Three checkpoints around the Bay. Beat the timer and the cash is yours.',
    stops: [
      { text: 'Checkpoint one: the ferris wheel bend', type: 'race', target: { x: 150, z: 240 }, timerSec: 30 },
      { text: 'Checkpoint two: the docks crane', type: 'race', target: 'Dockside', timerSec: 30 },
      { text: 'Checkpoint three: the beach finish line', type: 'race', target: 'Coral Beach', timerSec: 30 },
    ],
    payout: 400,
  },
];

/** 24 collectible conch shells across the island, each snapped onto the road grid. */
export const SHELLS = [
  snapToRoad(-268, -230), snapToRoad(-256, -120), snapToRoad(-262, -20),
  snapToRoad(-258, 60), snapToRoad(-254, 150), snapToRoad(-266, 230),
  snapToRoad(-200, -260), snapToRoad(-140, -200), snapToRoad(-80, -240),
  snapToRoad(-20, -180), snapToRoad(40, -250), snapToRoad(100, -190),
  snapToRoad(160, -260), snapToRoad(220, -200), snapToRoad(180, -120),
  snapToRoad(90, -60), snapToRoad(-30, -30), snapToRoad(-150, 20),
  snapToRoad(-60, 90), snapToRoad(30, 170), snapToRoad(130, 110),
  snapToRoad(220, 140), snapToRoad(200, 210), snapToRoad(110, 250),
];

/** Total collectible conch shells, so the HUD can show n/24 from the data. */
export const SHELL_TOTAL = SHELLS.length;

/** Resolve a district name to its world centre snapped onto the road grid. */
export function districtPoint(name) {
  const d = DISTRICTS.find((e) => e.name === name);
  return d ? snapToRoad(d.centre.x, d.centre.z) : { x: 0, z: 0 };
}

/** Look up a story mission by its id, e.g. 'm3'. */
export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}