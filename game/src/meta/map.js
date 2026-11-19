// LUMEN BAY full-screen map: large canvas of the whole island with districts,
// roads, beach, marina/ferris wheel, player marker, mission target, police
// blips and shells; a side panel lists missions + career stats. M / Esc close.
import { WORLD, DISTRICTS } from '../config.js';
import { MISSIONS, SHELLS, SHELL_TOTAL } from '../missions/catalog.js';

const MAP = 720;          // canvas px square
const WORLD_W = WORLD.total; // island span in metres

/** Build the full map screen inside #map-screen. Returns { open, close }.
 *  `player` -> {x,z} current world position for the player marker;
 *  `police` -> optional { units() } provider for live police blips.
 */
export function createMap(state, player = () => ({ x: 0, z: 0 }), police = null) {
  const dom = document.getElementById('map-screen');
  if (!dom) return { open: () => {}, close: () => {} };

  function toPx(x, z) {
    const s = MAP / WORLD_W;
    return { px: (x + WORLD_W / 2) * s, py: (z + WORLD_W / 2) * s };
  }

  function open() {
    dom.innerHTML = '';
    dom.style.display = 'flex';

    const cv = document.createElement('canvas');
    cv.width = MAP;
    cv.height = MAP;
    cv.className = 'map-canvas';
    const ctx = cv.getContext('2d');
    const panel = document.createElement('div');
    panel.className = 'map-panel';
    dom.appendChild(cv);
    dom.appendChild(panel);
    drawIsland(ctx);
    drawBlips(ctx);
    buildPanel(panel);
    // --map-done-- marker: done
  }

  /** Fill the sea, then the sand strip, then each district's building lot. */
  function drawIsland(ctx) {
    // Sea: deep blue out to the map edge.
    ctx.fillStyle = '#0b2a38';
    ctx.fillRect(0, 0, MAP, MAP);

    // Beach along the west (x-negative) edge, a narrow sand band.
    const beachHalf = 30;
    const b0 = toPx(-WORLD_W / 2, 0);
    const b1 = toPx(-WORLD_W / 2 + beachHalf, 0);
    ctx.fillStyle = '#e8d9a8';
    ctx.fillRect(b0.px, 0, b1.px - b0.px, MAP);

    // District blocks: pastel lots in the district's palette colour.
    for (const d of DISTRICTS) {
      const cx = d.centre.x;
      const cz = d.centre.z;
      const half = WORLD.block / 2 + WORLD.road;
      const a = toPx(cx - half, cz - half);
      const b = toPx(cx + half, cz + half);
      ctx.fillStyle = d.palette[0];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(a.px, a.py, b.px - a.px, b.py - a.py);
      ctx.globalAlpha = 1;
    }

    drawRoads(ctx);
    drawFerris(ctx);
    drawDistrictLabels(ctx);
    // --map-blips-- marker: markers/player drawn after roads
  }

  /** The road grid: one ring road around each block, lighter lane lines. */
  function drawRoads(ctx) {
    ctx.strokeStyle = 'rgba(150,210,235,0.75)';
    ctx.lineWidth = 3;
    const step = WORLD.block + WORLD.road;
    for (let i = 0; i <= WORLD.blocks; i += 1) {
      const x = -WORLD_W / 2 + i * step;
      const p1 = toPx(x, 0);
      const p2 = toPx(x, WORLD_W);
      ctx.beginPath();
      ctx.moveTo(p1.px, 0);
      ctx.lineTo(p1.px, MAP);
      ctx.stroke();
      const z = -WORLD_W / 2 + i * step;
      const q1 = toPx(0, z);
      const q2 = toPx(WORLD_W, z);
      ctx.beginPath();
      ctx.moveTo(0, q1.py);
      ctx.lineTo(MAP, q1.py);
      ctx.stroke();
    }
    // Island frame.
    ctx.strokeStyle = '#2ae0c0';
    ctx.strokeRect(0.5, 0.5, MAP - 1, MAP - 1);
  }

  /** The Marina ferris wheel: a small ring with spokes near its world spot. */
  function drawFerris(ctx) {
    const p = toPx(210, 240);
    ctx.strokeStyle = '#a8e6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.px, p.py, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.px - 7, p.py); ctx.lineTo(p.px + 7, p.py);
    ctx.moveTo(p.px, p.py - 7); ctx.lineTo(p.px, p.py + 7);
    ctx.stroke();
  }

  /** District names pinned at their hub, in their palette's dark accent. */
  function drawDistrictLabels(ctx) {
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    for (const d of DISTRICTS) {
      const p = toPx(d.centre.x, d.centre.z);
      ctx.fillStyle = 'rgba(12,18,28,0.82)';
      ctx.fillText(d.name.toUpperCase(), p.px, p.py + 3);
    }
  }

  // --map-functions-- marker: more drawing helpers below

  /** A filled circle blip at a world point, in a colour. */
  function blip(ctx, x, z, colour, r = 5) {
    const p = toPx(x, z);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
    ctx.fill();
    return p;
  }

  /** The player as a forward-pointing triangle (no heading needed on a full
   *  map; keep it a plain white arrow pointing north for clarity). */
  function drawPlayer(ctx) {
    const pv = player();
    const p = toPx(pv.x, pv.z);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(p.px, p.py - 8);
    ctx.lineTo(p.px + 6, p.py + 6);
    ctx.lineTo(p.px, p.py + 2.5);
    ctx.lineTo(p.px - 6, p.py + 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffd9a0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** Draw the live markers over the island: shells, mission target, police. */
  function drawBlips(ctx) {
    // Conch shells the player has NOT yet found: amber dots.
    const found = state.shells || 0;
    let shown = 0;
    for (const s of SHELLS) {
      if (shown >= found) blip(ctx, s.x, s.z, '#ffd9a0', 3.4);
      else shown += 1;
    }
    // Mission / side-job target: a yellow diamond.
    const target = state.missionTarget || state.sideJobTarget;
    if (target) {
      const p = toPx(target.x, target.z);
      ctx.fillStyle = '#ffd900';
      ctx.beginPath();
      ctx.moveTo(p.px, p.py - 6);
      ctx.lineTo(p.px + 5, p.py);
      ctx.lineTo(p.px, p.py + 6);
      ctx.lineTo(p.px - 5, p.py);
      ctx.closePath();
      ctx.fill();
    }
    // Police blips: the HUD minimap uses police.units(); mirror the same.
    const squad = police && police.units ? police.units() : (state.policeUnits || []);
    for (const u of squad) {
      blip(ctx, u.pos.x, u.pos.z, (u.name && u.name.indexOf('HELI') >= 0) ? '#ff4a4a' : '#4a7aff', 3.6);
    }
    drawPlayer(ctx);
  }

  // --map-panel-- marker: side panel content below

  /** The side panel: mission list with DONE/ACTIVE/LOCKED, plus career stats
   *  and a legend. Built fresh each time the map opens. */
  function buildPanel(panel) {
    const ms = (state.missions || []);
    let list = '';
    for (const mi of ms) {
      const def = MISSIONS.find((x) => x.id === mi.id);
      const cls = (mi.status || '').toLowerCase();
      const st = mi.status || 'LOCKED';
      list += `<div class="mp-mission ${cls}">
        <span class="mp-status">${st}</span>
        <span class="mp-ch">CH.${def ? def.chapter : '?'}</span>
        <span class="mp-title">${def ? def.title : mi.id}</span>
      </div>`;
    }

    const comp = state.completionPct ? state.completionPct() : 0;
    const timePlayed = Math.floor(state.playSeconds || 0);
    const hh = String(Math.floor(timePlayed / 3600)).padStart(2, '0');
    const mm = String(Math.floor((timePlayed % 3600) / 60)).padStart(2, '0');
    const ss = String(timePlayed % 60).padStart(2, '0');

    const stat = (k, v) => `<div class="mp-stat"><span class="mp-k">${k}</span><span class="mp-v">${v}</span></div>`;

    panel.innerHTML = `
      <div class="mp-head">LUMEN BAY <span>MAP</span></div>
      <div class="mp-sec">MISSIONS</div>
      <div class="mp-list">${list}</div>
      <div class="mp-sec">CAREER</div>
      <div class="mp-stats">
        ${stat('MONEY', '$' + Number(state.money || 0).toLocaleString())}
        ${stat('REP', `${state.repName} \u00b7 TIER ${state.rep || 1}`)}
        ${stat('XP', String(state.repXp || 0))}
        ${stat('COMPLETE', `${Math.round(comp)}%`)}
        ${stat('TIME', `${hh}:${mm}:${ss}`)}
        ${stat('CONCH', `${state.shells || 0}/${SHELL_TOTAL}`)}
        ${stat('CARS STOLEN', String(state.carsStolen || 0))}
        ${stat('TAKEDOWNS', String(state.takedowns || 0))}
        ${stat('ESCAPES', String(state.escapes || 0))}
      </div>
      <div class="mp-sec">LEGEND</div>
      <div class="mp-legend">
        ${legendItem('#2ae0c0', 'Story mission')}
        ${legendItem('#4a7aff', 'Garage / safehouse')}
        ${legendItem('#ffd9a0', 'Taxi / taco / race')}
        ${legendItem('#ffd900', 'Objective')}
        ${legendItem('#ffb37a', 'Conch shell')}
        ${legendItem('#ff4a4a', 'Police / heli')}
        ${legendItem('#7dffb0', 'Hospital / respray')}
      </div>
    `;
  }

  /** One legend row: a colour swatch + label. */
  function legendItem(colour, label) {
    return `<div class="mp-leg"><span class="mp-sw" style="background:${colour}"></span><span>${label}</span></div>`;
  }

  return { open, close: () => { dom.innerHTML = ''; dom.style.display = 'none'; } };
}