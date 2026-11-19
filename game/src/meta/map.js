// LUMEN BAY full-screen map: large canvas of the whole island with districts,
// roads, beach, marina/ferris wheel, player marker, mission target, police
// blips and shells; a side panel lists missions + career stats. M / Esc close.
import { WORLD, DISTRICTS } from '../config.js';
import { MISSIONS, SHELLS, SHELL_TOTAL } from '../missions/catalog.js';

const MAP = 720;          // canvas px square
const WORLD_W = WORLD.total; // island span in metres

/** Build the full map screen inside #map-screen. Returns { open, close }.
 *  `player` -> {x,z} current world position for the player marker;
 *  `police` -> optional { units() } provider for live police blips;
 *  `markers` -> () => job-giver marker list ({pos,label,kind}) from main.js;
 *  `getShells` -> () => live conch handles ({mesh,pos,taken}, catalog SHELLS
 *  order) from placeShells(), so blips mark exactly the untaken shells.
 */
export function createMap(state, player = () => ({ x: 0, z: 0 }), police = null, markers = () => [], getShells = () => []) {
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

  /** Sea, organic coastline, sand fringe, per-block lots, cased roads and
   *  bridges — layered so the screen reads as an island with streets. */
  function drawIsland(ctx) {
    // Sea: depth gradient — lighter turquoise near the shore, deep blue-teal
    // out at the canvas edge.
    const sea = ctx.createRadialGradient(MAP / 2, MAP / 2, MAP * 0.22, MAP / 2, MAP / 2, MAP * 0.72);
    sea.addColorStop(0, '#1d7a86');
    sea.addColorStop(0.55, '#12505f');
    sea.addColorStop(1, '#081e2e');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, MAP, MAP);
    drawWaves(ctx);

    // Land: rounded-corner coastline inset from the frame, with a west cove
    // (Coral Beach side) and a south inlet. The sand fill doubles as the thin
    // sand ring around the whole coast; the pale stroke is the surf line.
    traceLand(ctx);
    ctx.strokeStyle = 'rgba(140,225,235,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#dfcb9b';
    ctx.fill();

    // Wider west beach band (Coral Beach side), clipped to the coastline.
    ctx.save();
    traceLand(ctx);
    ctx.clip();
    ctx.fillStyle = '#ecd9a6';
    ctx.fillRect(0, 0, 46, MAP);
    ctx.restore();

    // Per-block lots: the same 8x8 walk as city.js createCity() — block
    // centre at westEdge + (g + 0.5) * (block + road), district = nearest
    // hub — tinted darker/desaturated so the cased roads sit on top.
    ctx.save();
    traceLand(ctx);
    ctx.clip();
    const step = WORLD.block + WORLD.road;
    const half = WORLD.block / 2;
    for (let gy = 0; gy < WORLD.blocks; gy += 1) {
      for (let gx = 0; gx < WORLD.blocks; gx += 1) {
        const cx = -WORLD_W / 2 + (gx + 0.5) * step;
        const cz = -WORLD_W / 2 + (gy + 0.5) * step;
        let best = DISTRICTS[0];
        let bestD = Infinity;
        for (const d of DISTRICTS) {
          const dist = (d.centre.x - cx) ** 2 + (d.centre.z - cz) ** 2;
          if (dist < bestD) { bestD = dist; best = d; }
        }
        const a = toPx(cx - half, cz - half);
        const b = toPx(cx + half, cz + half);
        ctx.fillStyle = lotTint(best.palette[(gx + gy) % best.palette.length]);
        ctx.fillRect(a.px, a.py, b.px - a.px, b.py - a.py);
      }
    }
    drawRoads(ctx);
    ctx.restore();

    drawBridges(ctx);
    drawFerris(ctx);
    drawDistrictLabels(ctx);
    // Island frame (outside the land clip so it rings the whole canvas).
    ctx.strokeStyle = '#2ae0c0';
    ctx.strokeRect(0.5, 0.5, MAP - 1, MAP - 1);
    // --map-blips-- marker: markers/player drawn after roads
  }

  /** The road grid: each centreline drawn twice — a dark casing underneath,
   *  then the pale centre line on top — so streets read at a glance against
   *  the lots. Same centreline math as before (westEdge + i * (block+road)). */
  function drawRoads(ctx) {
    const step = WORLD.block + WORLD.road;
    for (const pass of [
      { style: 'rgba(18,24,40,0.9)', width: 7 },
      { style: 'rgba(150,210,235,0.75)', width: 3 },
    ]) {
      ctx.strokeStyle = pass.style;
      ctx.lineWidth = pass.width;
      for (let i = 0; i <= WORLD.blocks; i += 1) {
        const x = -WORLD_W / 2 + i * step;
        const px = toPx(x, 0).px;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, MAP);
        ctx.stroke();
        const z = -WORLD_W / 2 + i * step;
        const py = toPx(0, z).py;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(MAP, py);
        ctx.stroke();
      }
    }
  }

  /** Trace the organic coastline: a rounded rectangle inset from the canvas
   *  edge, with a cove bowing inland on the west beach side and an inlet on
   *  the south. Reused for the sand fill, the surf stroke and the lot clip. */
  function traceLand(ctx) {
    const L = 18;
    const T = 18;
    const R = MAP - 18;
    const B = MAP - 18;
    const r = 48;
    ctx.beginPath();
    ctx.moveTo(L + r, T);
    ctx.lineTo(R - r, T);
    ctx.quadraticCurveTo(R, T, R, T + r);
    ctx.lineTo(R, B - r);
    ctx.quadraticCurveTo(R, B, R - r, B);
    // South inlet between the Old Quarter and the Marina.
    ctx.lineTo(580, B);
    ctx.quadraticCurveTo(505, B - 116, 430, B);
    ctx.lineTo(L + r, B);
    ctx.quadraticCurveTo(L, B, L, B - r);
    // West cove on the Coral Beach side.
    ctx.lineTo(L, 420);
    ctx.quadraticCurveTo(L + 92, 335, L, 250);
    ctx.lineTo(L, T + r);
    ctx.quadraticCurveTo(L, T, L + r, T);
    ctx.closePath();
  }

  /** Darken + desaturate a district palette colour into a building-lot tint
   *  (55% colour, 45% dark slate) so the cased roads read on top. Pure maths,
   *  no rng — the map never touches the shared seed chain. */
  function lotTint(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (shift, slate) => Math.round(((n >> shift) & 255) * 0.55 + slate * 0.45);
    return `rgb(${ch(16, 38)},${ch(8, 42)},${ch(0, 56)})`;
  }

  /** A few thin, low-alpha swell arcs offshore in the sea margin. */
  function drawWaves(ctx) {
    ctx.strokeStyle = 'rgba(150,225,235,0.16)';
    ctx.lineWidth = 1;
    const arcs = [
      [12, 12, 18, 0, Math.PI / 2],
      [MAP - 12, 12, 18, Math.PI / 2, Math.PI],
      [12, MAP - 12, 18, -Math.PI / 2, 0],
      [MAP - 12, MAP - 12, 18, Math.PI, Math.PI * 1.5],
      [MAP / 2, 6, 14, 0.3, Math.PI - 0.3],
      [6, MAP / 2, 14, Math.PI * 0.65, Math.PI * 1.35],
      [MAP - 6, MAP / 2, 14, -Math.PI * 0.35, Math.PI * 0.35],
      [MAP / 2, MAP - 6, 14, Math.PI + 0.3, Math.PI * 2 - 0.3],
    ];
    for (const [x, y, r, a0, a1] of arcs) {
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a1);
      ctx.stroke();
    }
  }

  /** Two bridges on top of the water, both tied into the road grid: a
   *  causeway across the south inlet mouth where the x=81 / x=155 avenues
   *  meet it, and a Marina pier extending the z=229 street east over the
   *  sea with a T-head and a moored boat. */
  function drawBridges(ctx) {
    const roadPx = WORLD.road * (MAP / WORLD_W);
    const deck = (a, b, casing, fill, width) => {
      ctx.strokeStyle = casing;
      ctx.lineWidth = width + 4;
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
    };
    // South causeway: road-width deck with a dashed centre line.
    const c0 = toPx(55, 249);
    const c1 = toPx(178, 249);
    deck(c0, c1, 'rgba(18,24,40,0.9)', '#4a5058', roadPx);
    ctx.strokeStyle = 'rgba(150,210,235,0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(c0.px, c0.py); ctx.lineTo(c1.px, c1.py); ctx.stroke();
    ctx.setLineDash([]);
    // Marina pier: narrower timber deck from the (229,229) intersection.
    const m0 = toPx(229, 229);
    const m1 = toPx(284, 229);
    deck(m0, m1, 'rgba(18,24,40,0.9)', '#8a7a5c', 6);
    ctx.strokeStyle = '#8a7a5c';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(m1.px, m1.py - 9); ctx.lineTo(m1.px, m1.py + 9); ctx.stroke();
    ctx.fillStyle = '#e8f4ff';
    ctx.beginPath(); ctx.arc(m1.px - 8, m1.py + 12, 2.2, 0, Math.PI * 2); ctx.fill();
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

  /** Draw the live markers over the island: shells, job givers, mission
   *  target, police. */
  function drawBlips(ctx) {
    // Conch shells the player has NOT yet taken: amber dots at the real
    // catalog spots. The live handles carry the taken flags (placeShells()
    // order === SHELLS order), so exactly the untaken shells are drawn —
    // never the first-N of the catalog, which goes wrong the moment
    // collection is non-sequential.
    const shellHandles = getShells();
    for (let i = 0; i < SHELLS.length; i += 1) {
      if (shellHandles[i] && shellHandles[i].taken) continue;
      blip(ctx, SHELLS[i].x, SHELLS[i].z, '#ffd9a0', 3.4);
    }
    // Job-giver markers: gold diamond + name for the story mission, teal
    // dots + names for taxi / taco / race — the same colours as the 3D
    // signs and the minimap blips, so the legend below stays true.
    for (const mk of markers()) {
      const p = toPx(mk.pos.x, mk.pos.z);
      const colour = mk.kind === 'mission' ? '#ffc24a' : '#2ae0c0';
      if (mk.kind === 'mission') {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(p.px, p.py - 7);
        ctx.lineTo(p.px + 6, p.py);
        ctx.lineTo(p.px, p.py + 7);
        ctx.lineTo(p.px - 6, p.py);
        ctx.closePath();
        ctx.fill();
      } else {
        blip(ctx, mk.pos.x, mk.pos.z, colour, 4);
      }
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = colour;
      ctx.fillText(mk.label, p.px, p.py + 16);
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
        ${legendItem('#ffc24a', 'Story mission')}
        ${legendItem('#2ae0c0', 'Taxi \u00b7 taco \u00b7 race')}
        ${legendItem('#ffd900', 'Objective')}
        ${legendItem('#ffd9a0', 'Conch shell')}
        ${legendItem('#4a7aff', 'Police car')}
        ${legendItem('#ff4a4a', 'Police heli')}
      </div>
    `;
  }

  /** One legend row: a colour swatch + label. */
  function legendItem(colour, label) {
    return `<div class="mp-leg"><span class="mp-sw" style="background:${colour}"></span><span>${label}</span></div>`;
  }

  return { open, close: () => { dom.innerHTML = ''; dom.style.display = 'none'; } };
}