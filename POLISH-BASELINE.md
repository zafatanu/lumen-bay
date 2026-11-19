# POLISH BASELINE — LUMEN BAY (make.fun gta6-01)

Pass 0 only: baseline inventory + protection + smoke check. No game code was
changed in this pass. Baseline commit: S19 `8d8e50b29eb910aaf9d5aadafe007058d3ab3741`
("S19: menu CONTINUE reads persisted save; unlock next before onComplete").
This report was produced by Hermes in one-shot `-z` mode.

## 1. Inventory (sizes in bytes, measured at S19)

Repo root (tracked):

    LICENSE                          1095
    README.md                        1382
    main.ts                          2733   (submission bundler + dossier caps)
    serve.ts                         2612   (local static server, port 8080)
    shots.json                        250   (4 shot queries, seed=1)
    vendor/makefun-game.ts          56282   (vendored make.fun dossier library)

game/ — 29 files, 921,443 bytes total (0.8788 MiB):

    game/index.html                              6736
    game/src/main.js                            27402
    game/src/config.js                           3908
    game/src/state.js                            6354
    game/src/input.js                            4010
    game/src/random.js                           1857
    game/src/shots.js                            7838
    game/src/render/scene.js                     6401
    game/src/city/city.js                       15916
    game/src/hud/hud.js                         13977
    game/src/hud/hud.css                        15711
    game/src/audio/radio.js                      7363
    game/src/meta/menu.js                        6433
    game/src/meta/map.js                         8780
    game/src/meta/pause.js                       2917
    game/src/missions/catalog.js                13174
    game/src/missions/missions.js                8266
    game/src/missions/sidejobs.js                6266
    game/src/missions/characters.js              6645
    game/src/player/onfoot.js                    5909
    game/src/vehicles/cars.js                    5215
    game/src/vehicles/driving.js                 7049
    game/src/vehicles/traffic.js                 8949
    game/src/combat/combat.js                   15107
    game/src/combat/weapons.js                   8632
    game/src/combat/enemies.js                  11310
    game/src/police/wanted.js                    3922
    game/src/police/units.js                    14715
    game/vendor/three/three.module.min.js      670681   (Three.js r160, vendored)

screenshots/ (4 JPEGs, the shot harness output):

    screenshots/1-chase.jpg                    103307
    screenshots/2-shootout.jpg                  74657
    screenshots/3-menu.jpg                     104662
    screenshots/4-map.jpg                       94117

out/ — untracked local build output (`MAKEFUN_OUTPUT_DIR=out node main.ts`):
dossier.json (671,610 B) plus mirrors of game/ and screenshots/. Not game
code, not committed, excluded from the backup.

Caps check (from main.ts / scorer gate):

- game/ file count: 29 of max 993 → 964 files of headroom. PASS.
- game/ total bytes: 921,443 of max 50,331,648 (48 MiB) → 49,410,205 bytes
  (~47.1 MiB) of headroom. PASS.
- Longest game/ path: 37 chars (game/vendor/three/three.module.min.js),
  cap 1000. PASS.
- Screenshots: 4 of max 4; largest 104,662 B of max 262,144 B each. PASS.

## 2. System map (owner file per system)

- Lighting / sky: `game/src/render/scene.js` — `createRenderer3D()` builds the
  WebGL renderer (ACES filmic, PCFSoft shadows), gradient sky-dome
  ShaderMaterial, warm DirectionalLight sun + HemisphereLight fill, fog,
  cloud billboards, and the sunset→night blend in `update(dt, clockMinutes)`.
  Palette constants (`SUNSET`, `DAY`) live in `game/src/config.js`.
- Water / coast: `game/src/city/city.js` — `buildWater()` (ocean plane + sand
  mound), `buildBoardwalk()`, `buildPalms()`; dimensions from `COAST`/`SEA`
  in `game/src/config.js`.
- HUD: `game/src/hud/hud.js` (`createHud`, read-only DOM + minimap canvas) and
  `game/src/hud/hud.css`; static DOM skeleton in `game/index.html`.
- Menu: `game/src/meta/menu.js` (`createMenu`, CONTINUE/NEW GAME/CONTROLS/
  SETTINGS/HOW TO PLAY, roster; `loadSettings`/`saveSettings` under
  localStorage key `lumen-bay-settings`). Screen switching, settings panel
  and the title orbit camera (`menuCamera`) live in `game/src/main.js`.
- Map: `game/src/meta/map.js` (`createMap`, full-screen island canvas +
  mission/stats side panel). The in-play minimap is drawn by
  `game/src/hud/hud.js`.
- Camera: chase cam `updateCamera()` in `game/src/vehicles/driving.js`;
  on-foot `followCamera()` in `game/src/player/onfoot.js`; menu orbit in
  `game/src/main.js`; tuning constants `CAMERA` in `game/src/config.js`.
- Shot staging: `game/src/shots.js` (`stageShot`, `SHOT_SCENES` =
  `['1-chase', '2-shootout', '3-menu', '4-map']`, served via
  `?shot=1-chase|2-shootout|3-menu|4-map`). The `?shot=` hook, autopilot
  snapshot replay and `window.__shotReady` flag are in `game/src/main.js`;
  capture queries in `shots.json`.
- Radio / audio synth: `game/src/audio/radio.js` (`createRadio`, three
  original WebAudio step-sequencer stations, no audio files: WAVE 88.1
  "Neon Drive", LAGOON 98.1 "Tide Lines", KSUN 91.7 "Golden Hour").
  Gesture-gated start (`ensureRadio`) and N-key cycling in
  `game/src/main.js`.
- Pedestrians: `game/src/vehicles/traffic.js` — `makePedestrian`,
  `initPedestrian`, `movePedestrian` (24 pooled peds, sidewalk walking,
  crosswalk crossing, flee from cars).
- Traffic: `game/src/vehicles/traffic.js` — `createTraffic` (14 pooled cars,
  lane routing `moveTraffic`/`turnTraffic`/`respawnTraffic`, near-miss
  detection). Car meshes/catalog: `game/src/vehicles/cars.js`.
- Vehicles / driving: `game/src/vehicles/driving.js` (`createDriver`:
  throttle/brake/reverse, speed-sensitive steering, handbrake drift, nitro,
  fuel, condition, `collideCity` road-grid collision) and
  `game/src/vehicles/cars.js` (`CARS` catalog incl. Bay Runner and Neon
  Comet, `buildCarMesh`). Enter/steal/exit wiring (`trySteal`, `exitCar`)
  in `game/src/main.js`.
- Combat: `game/src/combat/combat.js` (`createCombat`: aim cone, hit
  resolution, damage to both sides, armour soak, tracers, muzzle flashes,
  melee); `game/src/combat/weapons.js` (`WEAPONS`, `createArsenal`, ammo/
  reload/unlocks, gun meshes); `game/src/combat/enemies.js` (`createEnemies`,
  `KINDS`: Gulls crew, PD on foot, Old Quarter thugs; road-grid enemy AI).
- Police / wanted / helicopter: `game/src/police/wanted.js` (`createWanted`:
  0–5 star heat meter, crime heat, escape/decay timers, bust) and
  `game/src/police/units.js` (`createPolice`: cruisers, INTERCEPTOR 1,
  ROADBLOCK UNIT, ram/box-in/bust AI, and the GULLWATCH spotter helicopter
  with rotor + spotlight cone at ≥3 stars). WASTED/BUSTED screens and
  respawn in `game/src/main.js`.
- Missions: `game/src/missions/missions.js` (`createMissions` stage engine:
  go/drive/deliver/shoot/survive/escape/race stages, timers, unlock flow);
  data in `game/src/missions/catalog.js` (`MISSIONS`, `SIDE_JOBS`, `SHELLS`,
  `CHARACTERS`, `snapToRoad`, `districtPoint`); side jobs + conch shells in
  `game/src/missions/sidejobs.js`; canvas portraits in
  `game/src/missions/characters.js`. Markers, beacon, rewards and autosave
  hooks wired in `game/src/main.js`.
- Save / load: `game/src/state.js` (`createState`, `save()`/`load()`/
  `reset()` under localStorage key `lumen-bay-save-v1`, defined as
  `SAVE_KEY` in `game/src/config.js`); settings persistence in
  `game/src/meta/menu.js` (`lumen-bay-settings`); `continueGame`/`newGame`
  in `game/src/main.js`.
- Pause: `game/src/meta/pause.js` (`createPause`).
- Renderer architecture / Three.js: `game/src/render/scene.js` (single
  WebGLRenderer, one scene, fixed 1/60 s sim step `STEP` in
  `game/src/config.js`, loop in `game/src/main.js`). Three.js **r160**
  (`REVISION = "160"`) vendored at `game/vendor/three/three.module.min.js`,
  mapped via the import map in `game/index.html`. No network requests.
- World road layout: `game/src/config.js` (`WORLD`: 8×8 blocks, 60 m lot +
  14 m road, 578 m island; `SPAWN`) and `game/src/city/city.js`
  (`buildGround` road painting, block assignment to districts, road
  colliders). The same road-grid clamp is mirrored in
  `game/src/vehicles/driving.js`, `game/src/player/onfoot.js`,
  `game/src/vehicles/traffic.js`, `game/src/police/units.js`,
  `game/src/combat/enemies.js` and `snapToRoad` in
  `game/src/missions/catalog.js`.
- Input / RNG: `game/src/input.js` (`createInput`), `game/src/random.js`
  (seeded rng; default `SEED = 20261117` in `game/src/config.js`, `?seed=`
  override).
- Submission harness: `main.ts` (copies game/ + screenshots/ to output,
  writes dossier.json via `vendor/makefun-game.ts`), `serve.ts` (local
  static server).

## 3. Mission catalog (exactly as defined in code)

8 story missions — `game/src/missions/catalog.js`, `MISSIONS` (ids m1–m8):

1. First Light (m1, giver Mama Luz, Old Quarter)
2. Hot Wheels (m2, giver Tito, Dockside)
3. Dockside Run (m3, giver Tito, Dockside)
4. The Getaway (m4, giver Ivy, Marina)
5. Neon Reign (m5, giver Ivy, Downtown)
6. High Tide (m6, giver Mama Luz, Marina)
7. Heat Wave (m7, giver Ivy, Downtown)
8. Golden Hour (m8, giver Mama Luz, Downtown)

5 districts — `game/src/config.js`, `DISTRICTS` (in definition order):

1. Coral Beach
2. Downtown
3. Old Quarter
4. Dockside
5. Marina

Also defined in the catalog: 3 side jobs (Taxi Fare, Taco Run, Street Race),
24 collectible conch shells (`SHELL_TOTAL`), and the cast: Rook (protagonist,
Getaway Driver), Mama Luz, Tito, Ivy, Captain Solano, Kestrel (The Gulls
boss). Hero car: Neon Comet; starter car: Bay Runner; police heli:
GULLWATCH. These are LUMEN BAY's own names and the only names allowed.

## 4. Reference images (viewed in place; yes/no only)

All five were opened and viewed successfully. They were NOT copied anywhere,
NOT used as screenshots, and no name or text from them was copied into the
game. (Full paths are as listed in the Pass 0 brief; one filename contains a
forbidden foreign-game token, so paths are not reproduced here.)

| # | Reference (shot code)     | Openable/viewable |
|---|---------------------------|-------------------|
| 1 | 4d marina sunset          | yes               |
| 2 | 1b open world v2          | yes               |
| 3 | 3c character portrait     | yes               |
| 4 | 3d city vista             | yes               |
| 5 | 4c beach sunset           | yes               |

## 5. Known-good backup

Location: `/home/hatch/workspace/makefun/gta6-01-lumen-bay-backup-S19/`

Made with `cp -r` from the repo at S19, then the copied `.git/` and `out/`
were deleted. Verified present: 39 files, ~1.4 MiB (game/ 29 files,
screenshots/ 4, plus LICENSE, README.md, main.ts, serve.ts, shots.json,
vendor/makefun-game.ts). This is the restore point for the polish pass.

## 6. Forbidden systems (protection list for the polish pass)

DO NOT touch, in any later pass:

- Core driving physics / collision (`game/src/vehicles/driving.js`
  `collideCity`, throttle/steering/drift model; on-foot clamp in
  `game/src/player/onfoot.js`).
- Traffic AI routing (`game/src/vehicles/traffic.js` lane/turn/respawn
  logic).
- Combat damage / hit detection (`game/src/combat/combat.js` hit resolution,
  damage numbers, armour soak; `game/src/combat/weapons.js` stats).
- Wanted / police escalation logic (`game/src/police/wanted.js` heat/star
  thresholds, escape timers; roster scaling in `game/src/police/units.js`).
- Helicopter AI (`game/src/police/units.js` GULLWATCH hover/spotlight
  behavior).
- Mission state machine (`game/src/missions/missions.js` stage flow,
  unlock order; stage data in `game/src/missions/catalog.js`).
- Save schema / localStorage keys (`lumen-bay-save-v1`,
  `lumen-bay-settings`; `game/src/state.js` save/load coercion).
- Renderer architecture (`game/src/render/scene.js` renderer/scene/loop
  structure; fixed-step loop in `game/src/main.js`).
- Three.js version (r160 vendored; no upgrades/swaps).
- World road layout (`WORLD` grid in `game/src/config.js`, road painting
  and colliders in `game/src/city/city.js`, all road-grid clamps and
  `snapToRoad` targets).

ALLOWED:

- Visual dressing of buildings (rooflines, setbacks, signage, props)
  without moving roads — primarily `game/src/city/city.js` building/prop
  builders and the facade texture helper in `game/src/render/scene.js`.
- Feel tuning (camera easing, animation smoothing) ONLY where it cannot
  change collision/physics behavior.

Naming protection: LUMEN BAY keeps its own names only (Rook, the Gulls,
Neon Comet, Coral Beach boulevard, its own districts and missions listed
above). Names belonging to any other game are forbidden in the code,
README, and screenshots.

## 7. Smoke check (read-only, Pass 0)

- `node --version`: v24.22.1.
- ESM syntax parse of every game module:
  `node --input-type=module --check` on all 26 files under `game/src/`
  → 26/26 OK, zero failures.
- No browser/runtime smoke was run in Pass 0 (bash restricted to read-only
  inspection, the backup copy, and the final commit/push); no game code,
  screenshots, or recordings were modified, stopped, or sealed.
- Working tree at baseline: clean except untracked `out/` (local build
  output, intentionally uncommitted).

Mode note: Hermes one-shot `-z` mode was used for this Pass 0 run.

## 8. Forward context (amendments 16:00-16:04 WIB, 19 Nov 2026)

### 8.1 Target raised

- Minimum TOP 10 (was TOP 15), set by Dzaki at 16:00 WIB.
- Quality bar: visuals must match the 5 reference images (golden-hour Miami
  art-deco coastal city, dense HUD, living streets, cover composition). Where
  a part of the game is far below that bar, it gets REBUILT properly — not
  patched, not reskinned.

### 8.2 Pass R verdicts (boss inspection of the 4 current screenshots)

- R1 Chase cover — REBUILD. Current frame: flat red sky, brown box buildings,
  tiny distant car; no police/heli/ocean visible. Rebuild as a low rear
  three-quarter chase camera, hero car large in frame, cruisers plus heli
  actually visible in-frame, coastal boulevard with ocean plus skyline,
  gradient sunset sky.
- R2 Shootout — REBUILD. Current frame: blocky figure alone on a dark empty
  floor; no enemies, no environment, no muzzle flash. Rebuild as character
  presentation, enemies at varied depths, marina/boardwalk setting, muzzle
  flash plus tracer, warm sunset light.
- R3 Map rendering — REBUILD. Current map: flat grid with no
  island/coastline/water/roads. Keep the mission list, career stats and
  legend panels; rebuild only the map drawing itself into an island with
  coastline, water, roads, bridges.
- R4 Hero car plus traffic dressing — REBUILD. Cars read as tiny boxes;
  rebuild the Neon Comet as a wedge silhouette and add varied traffic
  shapes/colors.
- Menu — POLISH only, not rebuild. Structure is good (wordmark, save
  summary, crew panel); fix HUD bleed-through behind it and dress the
  background city.
- HUD — POLISH. Dense and mostly good; fix the clipped minimap label, the
  four identical PATROL 1 call signs (generic filler — need distinct call
  signs), placeholder-ish free-roam text, and panels overlapping on
  menu/map screens.

### 8.3 Pass A note

Treat the showcase districts dressing as a REBUILD, not a patch: art-deco
pastel facades, vertical fins, awnings, signage on the boulevard and marina,
so the city stops reading as brown boxes.

### 8.4 Forbidden names (addition)

Add one more forbidden name to the list: the famous Miami boulevard name
from the other entry, forbidden in LUMEN BAY code, README, and screenshots.
The literal name is not reproduced in this report. The existing handling in
sections 4 and 6 stands (forbidden names not reproduced in this report).

### 8.5 New pass order (3-model consensus; supersedes the previous order)

0 baseline → A atmosphere/lighting/world depth → C staging plus hero chase
→ D living city plus fluid feel → R rebuild (shootout plus map plus car
dressing) → B HUD/menu/map → E audio → F source-outline judge index →
G capture plus audit.

Priority and effort split: hero chase 30, lighting-world 25, stiffness-life
20, shootout plus HUD 15, audio plus map/menu plus micro-VFX 10. If time
gets tight, cut ornament polish BEFORE cutting living-world behavior.

### 8.6 Constraints per pass (all binding)

- Pass C staging: LIVE staging only. `?stage=chase` sets starting positions,
  wanted state, mission state, time, camera, through EXISTING interfaces
  only. Traffic keeps moving, heli rotor spins, lightbar flashes,
  water/particles stay alive. NEVER spawn fake props, NEVER freeze physics.
  4 stars only if the frame stays clean (3 stars is fine). Normal game runs
  unchanged with no query string.
- Pass A lighting: RESTRAINED golden hour. Palette reference only (zenith
  `#1a0b2e`, sun glow `#fc913a`). Sun 5-8 degrees off-center, warm key plus
  violet/cool fill, moderate fog (island density must stay visible),
  sun-path on water only if cheap, selective emissive. FORBIDDEN: blanket
  neon, neon roofline trims, neon HUD on four corners.
- Pass A/R not-boxy: geometry that changes SILHOUETTE plus motion: awnings,
  balconies, roof equipment, signs, fences, power poles, parked cars,
  planters, beach wall, palms in uneven clusters, on SCREENSHOT-FACING
  streets only, not all facades. Vehicles: sloped profile (hood taper,
  sloped windshield, wheel wells, emissive light bar, spinning wheels),
  body roll/pitch, tire smoke. Character: lean/recoil pose. Neon tape is
  FORBIDDEN as the boxy fix.
- Pass B HUD: ONE font, ONE panel language (dark translucent, thin
  restrained border). Tight corners: mission top-LEFT, wanted top-CENTER,
  cash/weapons top-RIGHT, minimap bottom-LEFT, interaction prompt
  bottom-CENTER, health/armor/speed bottom-RIGHT. No duplicate readouts.
  This moves wanted stars from top-right to top-center, superseding the
  earlier 4-corner plan.
- Missions: 8 shown COMPACT: numbered dossier list, chapter grouping if the
  story supports it, completion/reward only if it already exists, side jobs
  clearly separated. NEVER 8 giant cards on the title screen.
- Pass R shootout: DEPTH LAYERS first, restrained VFX second. Foreground:
  Rook, weapon, muzzle flash. Midground: enemies, cover, impact.
  Background: dockside, coastal road, police response. Muzzle flash YES,
  lightbar glow YES, spotlight if visible; tracer/underglow CONDITIONAL
  or no.
- Pass B map: AUTHORED geography: coastline, road hierarchy, districts,
  landmarks, markers, legend, player position. Blueprint-inspired but
  readable.
- Pass E audio: FUNCTIONAL GATE, not a visual pass. Keep and EXPAND the
  existing synth radio (more stations/songs) plus engine rev, siren,
  gunshots, impact, UI sounds, sea/city ambience. Verify music plays after
  user gesture; independent music/SFX controls if supported; NO external
  audio dependencies; do NOT build a new radio system.
- Pass G capture: FOUR FRAMES, FOUR TRUTHS: chase equals world reacting;
  shootout equals combat plus police escalation running; map equals
  authored island; menu equals progression plus identity.
- EXECUTION RULES for all passes: bounded edits, ONE module per run; verify
  playability per module; keep a known-good version per pass; check the
  diff. Screenshot gate and gameplay gate are SEPARATE. Before final
  capture, a clean-load playthrough test: drive, mission, combat, wanted,
  fail/win, restart, menu/map, resume.
- REMOVAL TEST for every effect (passes C and R): if removing an effect
  makes the scene clearer without weakening gameplay readability, REMOVE
  it. Restraint, not max features.
- RISKS to record: staging that bypasses real systems (fake game behind a
  pretty screenshot), forbidden by the live-staging rule; polish regression
  Qwen cannot playtest, the coordinator playtests each big pass; visual
  overload, restrained by the removal test; context rot from big rewrites,
  modular structure locked first, one module per prompt.
