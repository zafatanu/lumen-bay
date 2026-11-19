// LUMEN BAY dense HUD: mission, police, minimap, wanted, speedo, dialogue,
// weapons, radio widget and score popups. Reads shared `state` every frame
// and writes plain DOM + canvas; positions come from config so the 1280x800
// layout stays legible. Nothing here is clickable — the HUD is read-only,
// and all interaction lives in the menu/map/pause overlays. No network.
import { WORLD, DISTRICTS, CAR, POLICE } from '../config.js';
import { WEAPONS } from '../combat/weapons.js';

const MINIMAP = 192;          // canvas px square
const WORLD_W = WORLD.total;  // island span in metres

/** Build the dense HUD. `dom` is the #hud element; `opts` carries live
 *  providers: getPlayer() -> {x,z,heading,inCar}, arsenal, radio. Returns
 *  { update(dt) } called every display frame. */
export function createHud(state, dom, opts = {}) {
  const $ = (id) => dom.querySelector(id);
  const player = opts.getPlayer || (() => ({ x: 0, z: 0, heading: 0, inCar: false }));
  const arsenal = opts.arsenal;
  const radio = opts.radio;
  const police = opts.police;
  // Live job-giver markers from main.js ({pos,label,kind}); empty if absent.
  const getMarkers = opts.getMarkers || (() => []);
  // Accumulated display time for the pulsing story-marker blip.
  let hudTime = 0;

  // ---- DOM handles for the static panels ---------------------------------
  const missionTitle = $('[data-hud="mission-title"]');
  const missionObj = $('[data-hud="mission-obj"]');
  const missionTimer = $('[data-hud="mission-timer"]');
  const missionStage = $('[data-hud="mission-stage"]');
  const missionNext = $('[data-hud="mission-next"]');
  const policeList = $('[data-hud="police-list"]');
  const minimap = $('[data-hud="minimap"]');
  const mmCtx = minimap ? minimap.getContext('2d') : null;
  const healthFill = $('[data-hud="health-fill"]');
  const armourFill = $('[data-hud="armour-fill"]');
  const repTier = $('[data-hud="rep-tier"]');
  const repFill = $('[data-hud="rep-fill"]');
  const wantedRow = $('[data-hud="wanted-stars"]');
  const wantedBanner = $('[data-hud="wanted-banner"]');
  const wantedBannerStars = $('[data-hud="wanted-banner-stars"]');
  const wantedSight = $('[data-hud="wanted-sight"]');
  const moneyEl = $('[data-hud="money"]');
  const clockEl = $('[data-hud="clock"]');
  const speedoKmh = $('[data-hud="speedo-kmh"]');
  const carName = $('[data-hud="car-name"]');
  const condFill = $('[data-hud="cond-fill"]');
  const nitroFill = $('[data-hud="nitro-fill"]');
  const fuelFill = $('[data-hud="fuel-fill"]');
  const onFootEl = $('[data-hud="on-foot"]');
  const dialogueEl = $('[data-hud="dialogue"]');
  const dialogueImg = $('[data-hud="dialogue-img"]');
  const dialogueName = $('[data-hud="dialogue-name"]');
  const dialogueLine = $('[data-hud="dialogue-line"]');
  const weaponsEl = $('[data-hud="weapons"]');
  const radioEl = $('[data-hud="radio"]');
  const radioStation = $('[data-hud="radio-station"]');
  const radioTrack = $('[data-hud="radio-track"]');
  const popupsEl = $('[data-hud="popups"]');

  // --hud-draw-- marker: minimap drawing helpers append below

  /** Map a world x/z to a minimap pixel so the whole 578m island fills the
   *  square. West (negative x) lands on the left, south (positive z) on top. */
  function toPx(x, z) {
    const s = MINIMAP / WORLD_W;
    return { px: (x + WORLD_W / 2) * s, py: (z + WORLD_W / 2) * s };
  }

  /** The district whose hub is nearest the player, for the minimap title. */
  function districtAt(x, z) {
    let best = DISTRICTS[0];
    let bestD = Infinity;
    for (const d of DISTRICTS) {
      const ddx = d.centre.x - x;
      const ddz = d.centre.z - z;
      const dd = ddx * ddx + ddz * ddz;
      if (dd < bestD) { bestD = dd; best = d; }
    }
    return best.name;
  }

  /** Draw the road grid as cased streets — dark under-stroke + pale centre
   *  line over a sea-tinted backing — so the minimap reads as streets, not
   *  faint scratches. Size, position and blips are unchanged. */
  function drawGrid() {
    mmCtx.fillStyle = '#0b2a38';
    mmCtx.fillRect(0, 0, MINIMAP, MINIMAP);
    for (const pass of [
      { style: 'rgba(18,24,40,0.9)', width: 4.5 },
      { style: 'rgba(150,210,235,0.7)', width: 2 },
    ]) {
      mmCtx.strokeStyle = pass.style;
      mmCtx.lineWidth = pass.width;
      for (let i = 0; i <= WORLD.blocks; i += 1) {
        const p = toPx(-WORLD_W / 2 + i * (WORLD.block + WORLD.road), 0).px;
        mmCtx.beginPath(); mmCtx.moveTo(p, 0); mmCtx.lineTo(p, MINIMAP); mmCtx.stroke();
        mmCtx.beginPath(); mmCtx.moveTo(0, p); mmCtx.lineTo(MINIMAP, p); mmCtx.stroke();
      }
    }
    mmCtx.strokeStyle = '#2ae0c0';
    mmCtx.strokeRect(0.5, 0.5, MINIMAP - 1, MINIMAP - 1);
  }

  /** A small north indicator and the district label in the top corner. */
  function drawNorth() {
    mmCtx.fillStyle = '#ffffff';
    mmCtx.font = 'bold 7px monospace';
    mmCtx.textAlign = 'center';
    mmCtx.fillText('N', MINIMAP - 8, 12);
    mmCtx.beginPath();
    mmCtx.moveTo(MINIMAP - 8, 4);
    mmCtx.lineTo(MINIMAP - 11, 14);
    mmCtx.lineTo(MINIMAP - 5, 14);
    mmCtx.closePath();
    mmCtx.fillStyle = '#ffd9a0';
    mmCtx.fill();
  }

  /** Draw a circular blip at a world point, in a colour, with a small label. */
  function blip(x, z, colour, label) {
    const { px, py } = toPx(x, z);
    mmCtx.fillStyle = colour;
    mmCtx.beginPath();
    mmCtx.arc(px, py, 2.6, 0, Math.PI * 2);
    mmCtx.fill();
    if (label) {
      mmCtx.fillStyle = '#ffffff';
      mmCtx.font = 'bold 6px monospace';
      mmCtx.textAlign = 'left';
      mmCtx.fillText(label, px + 4, py + 3);
    }
  }

  /** The player as a forward-pointing triangle; rotates with heading. */
  function drawPlayer(x, z, heading) {
    const { px, py } = toPx(x, z);
    mmCtx.save();
    mmCtx.translate(px, py);
    mmCtx.rotate(heading);
    mmCtx.fillStyle = '#ffffff';
    mmCtx.beginPath();
    mmCtx.moveTo(0, -5);
    mmCtx.lineTo(3.5, 4);
    mmCtx.lineTo(0, 2.2);
    mmCtx.lineTo(-3.5, 4);
    mmCtx.closePath();
    mmCtx.fill();
    mmCtx.restore();
  }

  /** A pulsing gold diamond for the story job-giver, with a faint halo ring
   *  so it reads as "go here" even at minimap scale. */
  function storyBlip(x, z) {
    const { px, py } = toPx(x, z);
    const r = 3.6 + Math.sin(hudTime * 2.6) * 1.1;
    mmCtx.strokeStyle = 'rgba(255,194,74,0.5)';
    mmCtx.lineWidth = 1;
    mmCtx.beginPath();
    mmCtx.arc(px, py, r + 2.6, 0, Math.PI * 2);
    mmCtx.stroke();
    mmCtx.fillStyle = '#ffc24a';
    mmCtx.beginPath();
    mmCtx.moveTo(px, py - r);
    mmCtx.lineTo(px + r, py);
    mmCtx.lineTo(px, py + r);
    mmCtx.lineTo(px - r, py);
    mmCtx.closePath();
    mmCtx.fill();
  }

  /** Redraw the whole minimap: grid, shells, markers, mission target, police, player. */
  function drawMinimap() {
    if (!mmCtx) return;
    const p = player();
    drawGrid();
    // Collectible shells: amber dots, once the player has found a few.
    const found = state.shells || 0;
    for (let i = 0; i < Math.min(6, found); i += 1) {
      const sx = -WORLD_W / 2 + (i * 91) % WORLD_W;
      const sz = -WORLD_W / 2 + (i * 173) % WORLD_W;
      blip(sx, sz, '#ffd9a0');
    }
    // Job-giver markers: pulsing gold diamond for the story mission, teal
    // dots for the taxi / taco / race givers (same colours as the 3D signs).
    for (const mk of getMarkers()) {
      if (mk.kind === 'mission') storyBlip(mk.pos.x, mk.pos.z);
      else blip(mk.pos.x, mk.pos.z, '#2ae0c0');
    }
    // Mission target / side-job target: a yellow diamond.
    const target = state.missionTarget || state.sideJobTarget;
    if (target) blip(target.x, target.z, '#ffd900', '★');
    // Police units: blue dots for ground cars, red for the heli / near cop.
    const squad = police && police.units ? police.units() : [];
    for (const u of squad) {
      const colour = (u.name && u.name.indexOf('HELI') >= 0) ? '#ff4a4a' : '#4a7aff';
      blip(u.pos.x, u.pos.z, colour);
    }
    if (police && police.heliActive && police.heliActive()) {
      const p = player();
      blip(p.x, p.z - 260, '#ff4a4a');
    }
    drawNorth();
    drawPlayer(p.x, p.z, p.heading);
    // District label in the top-left corner of the minimap ring.
    mmCtx.fillStyle = '#ffffff';
    mmCtx.font = 'bold 10px monospace';
    mmCtx.textAlign = 'left';
    mmCtx.fillText(districtAt(p.x, p.z).toUpperCase(), 8, MINIMAP - 8);
  }

  // --hud-panels-- marker: per-panel update functions append below

  /** Top-left mission panel: chapter title, objective, timer, stage bar, next. */
  function updateMission() {
    const active = state.currentMission;
    if (!active) {
      if (missionTitle) missionTitle.textContent = '';
      if (missionObj) missionObj.textContent = 'Free roam \u2014 follow the gold beacon and press E to start a job.';
      if (missionTimer) missionTimer.textContent = '';
      if (missionStage) missionStage.textContent = '';
      if (missionNext) missionNext.textContent = '';
      return;
    }
    if (missionTitle) missionTitle.textContent = 'JOB \u00b7 ' + String(active).toUpperCase();
    // missionNext is "STAGE 2/4: <objective text>"; strip the stage prefix so
    // the objective line reads cleanly and the stage bar stays its own row.
    const full = state.missionNext || '';
    const obj = full.replace(/^STAGE \d+\/\d+:?\s*/, '');
    if (missionObj) missionObj.textContent = obj;
    if (missionTimer) missionTimer.textContent = state.missionTimer != null ? `\u23F1 ${Math.ceil(state.missionTimer)}s` : '';
    if (missionStage) missionStage.textContent = state.missionStage || '';
    if (missionNext) missionNext.textContent = state.missionStage ? `NEXT \u00b7 ${obj}` : '';
  }

  /** Mid-left police roster: each unit name, distance in m, and AI state. */
  function updatePolice() {
    if (!policeList) return;
    const feed = state.policeFeed || [];
    if (feed.length === 0) {
      policeList.innerHTML = '<div class="pl-clear">CLEAR \u2014 no heat</div>';
      return;
    }
    let html = '<div class="pl-title">LUMEN BAY PD</div>';
    for (const u of feed) {
      const stateCls = (u.state || 'EN ROUTE').toLowerCase().replace(/\s+/g, '-');
      html += `<div class="pl-row">
        <span class="pl-name">${u.name}</span>
        <span class="pl-dist">${u.distanceM}m</span>
        <span class="pl-state ${stateCls}">${u.state || 'EN ROUTE'}</span>
      </div>`;
    }
    policeList.innerHTML = html;
  }

  /** Bottom-left bars under the minimap: health, armour, REP tier + XP. */
  function updateBars() {
    if (healthFill) healthFill.style.width = Math.max(0, Math.min(100, state.health)) + '%';
    if (armourFill) armourFill.style.width = Math.max(0, Math.min(100, state.armour)) + '%';
    if (repTier) repTier.textContent = `${state.repName} \u00b7 TIER ${state.rep || 1}`;
    if (repFill) {
      const pct = state.repXp ? Math.min(100, (state.repXp % 25) / 25 * 100) : 0;
      repFill.style.width = pct + '%';
    }
  }

  /** Top-right: wanted stars, money, day + clock, plus the WANTED banner
   *  (star count + IN SIGHT chip) that shows whenever wanted >= 1. */
  function updateTopRight() {
    const max = 5;
    const lit = Math.max(0, Math.min(max, state.stars));
    if (wantedRow) {
      let stars = '';
      for (let i = 0; i < max; i += 1) stars += i < lit ? '\u2605' : '\u2606';
      wantedRow.textContent = stars;
    }
    // WANTED banner: reuses the wanted controller's own sighting tracking —
    // wanted.js resets hideTimer to 0 on every step a unit keeps eyes on Rook
    // and records lastSeenPos, so hideTimer === 0 with a last-seen record
    // means "in sight right now". No new state is invented here.
    if (wantedBanner) {
      if (lit > 0) {
        wantedBanner.style.display = 'flex';
        if (wantedBannerStars) wantedBannerStars.textContent = '\u2605'.repeat(lit);
        const inSight = !!state.lastSeenPos && state.hideTimer === 0;
        if (wantedSight) wantedSight.style.display = inSight ? '' : 'none';
      } else {
        wantedBanner.style.display = 'none';
      }
    }
    if (moneyEl) moneyEl.textContent = '$' + Number(state.money).toLocaleString();
    if (clockEl) clockEl.textContent = `Day ${state.day} \u00b7 ${state.formatClock()}`;
  }

  // --hud-panels-2-- marker: second half of the panels append below

  /** Bottom-right speedometer: big km/h, car name, condition/nitro/fuel bars,
   *  or an ON FOOT readout with the current weapon. */
  function updateSpeedo() {
    if (state.inCar && state.currentCar) {
      const car = state.currentCar;
      if (speedoKmh) speedoKmh.textContent = String(Math.round(state.speedKmh || 0));
      if (carName) carName.textContent = car.name;
      if (condFill) condFill.style.width = Math.max(0, Math.min(100, car.condition)) + '%';
      if (nitroFill) nitroFill.style.width = Math.max(0, Math.min(100, car.nitro)) + '%';
      if (fuelFill) fuelFill.style.width = Math.max(0, Math.min(100, car.fuel)) + '%';
      if (onFootEl) onFootEl.style.display = 'none';
    } else {
      if (speedoKmh) speedoKmh.textContent = '0';
      if (carName) carName.textContent = 'ON FOOT';
      if (condFill) condFill.style.width = '0%';
      if (nitroFill) nitroFill.style.width = '0%';
      if (fuelFill) fuelFill.style.width = '0%';
      if (onFootEl) {
        const w = arsenal && arsenal.current ? arsenal.current.name : 'Fists';
        onFootEl.style.display = 'block';
        onFootEl.textContent = w;
      }
    }
  }

  /** Bottom-centre dialogue: portrait + speaker + line; hidden when idle. */
  function updateDialogue() {
    if (!dialogueEl) return;
    const d = state.dialogue;
    if (!d) {
      dialogueEl.style.display = 'none';
      return;
    }
    dialogueEl.style.display = 'block';
    if (dialogueImg && d.portrait) dialogueImg.src = d.portrait;
    if (dialogueName) dialogueName.textContent = d.who || '';
    if (dialogueLine) dialogueLine.textContent = d.line || '';
  }

  /** Weapon slots 1-4: name + ammo; locked ones greyed with a REP note. */
  function updateWeapons() {
    if (!weaponsEl) return;
    let html = '';
    for (const w of WEAPONS) {
      const ammo = arsenal ? arsenal.ammoFor(w.id) : { locked: true, mag: 0, reserve: 0 };
      const locked = ammo.locked;
      const mag = Number.isFinite(ammo.mag) ? ammo.mag : '\u221e';
      const reserve = Number.isFinite(ammo.reserve) ? ammo.reserve : '';
      const isCur = arsenal && arsenal.current && arsenal.current.id === w.id ? ' cur' : '';
      html += `<div class="slot${locked ? ' locked' : ''}${isCur}">
        <span class="slot-key">${w.index}</span>
        <span class="slot-name">${w.short}</span>
        <span class="slot-ammo">${locked ? `REP ${w.rep}` : `${mag}${reserve ? ' / ' + reserve : ''}`}</span>
      </div>`;
    }
    weaponsEl.innerHTML = html;
  }

  /** Radio widget: station + frequency + current track (N cycles). Reads the
   *  live station from state (set by main.js from radio.current()) so the HUD
   *  never depends on the radio object being wired up. */
  function updateRadio() {
    if (!radioEl) return;
    const cur = radio ? radio.current() : null;
    const st = (state.radioStation || (cur ? `${cur.station} \u00b7 ${cur.freq} MHz` : ''));
    const tr = (state.radioTrack || (cur ? cur.track : ''));
    if (!st && !tr) {
      radioStation.textContent = 'OFF AIR';
      radioTrack.textContent = 'press N';
      return;
    }
    radioStation.textContent = st;
    radioTrack.textContent = tr;
  }

  /** Centre-right score popups: drift, near miss, shell, mission payout. */
  function updatePopups() {
    if (!popupsEl) return;
    if (!state.popups) state.popups = [];
    if (!state.popups.length) {
      if (popupsEl.children.length) popupsEl.innerHTML = '';
      return;
    }
    let html = '';
    for (const p of state.popups) {
      const fade = p.t < 0.8 ? ' pop-fade' : '';
      html += `<div class="popup${fade}">${p.text}</div>`;
    }
    popupsEl.innerHTML = html;
  }

  // --hud-panels-3-- marker: all panels defined

  function update(dt) {
    hudTime += dt;
    drawMinimap();
    updateMission();
    updatePolice();
    updateBars();
    updateTopRight();
    updateSpeedo();
    updateDialogue();
    updateWeapons();
    updateRadio();
    updatePopups();
  }

  return { update };
}