// LUMEN BAY character portraits: flat-colour stylised faces drawn on a
// 128x128 canvas per character, returned as data-URLs for the dialogue HUD.
// Distinct colour blocks: face shape, hair, jacket colour, a district-tinted
// background and a name tag. No photos, no likeness — original art only.

import { DISTRICTS } from '../config.js';

/** Named cast colour/text hints, mirroring catalog.js CHARACTERS. */
export const CHARACTER_PORTRAITS = {
  Rook: { skin: '#d9a87c', hair: '#2b2b33', jacket: '#1fb9a8', bg: '#ffd9e6' },
  'Mama Luz': { skin: '#c68f63', hair: '#8a8a92', jacket: '#8a6b52', bg: '#f2d7a0' },
  Tito: { skin: '#c68f63', hair: '#4a3a2a', jacket: '#e0891f', bg: '#9aa3ae' },
  Ivy: { skin: '#e6b98f', hair: '#7a3fd0', jacket: '#9a5bd0', bg: '#a8e6ff' },
  'Captain Solano': { skin: '#c68f63', hair: '#1a1a2a', jacket: '#2a3a6b', bg: '#b8c6ff' },
  Kestrel: { skin: '#d9a87c', hair: '#3a2a1a', jacket: '#c0392b', bg: '#9aa3ae' },
};

/** Small flat-colour face: draw the shared head/neck/torso base used by every
 *  character, then each face paints its own hair, jacket trim and name tag. */
function drawBase(ctx, c) {
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, 128, 128);
  // torso
  ctx.fillStyle = c.jacket;
  ctx.fillRect(28, 92, 72, 36);
  // neck
  ctx.fillStyle = c.skin;
  ctx.fillRect(58, 80, 12, 14);
  // head
  ctx.beginPath();
  ctx.arc(64, 62, 30, 0, Math.PI * 2);
  ctx.fillStyle = c.skin;
  ctx.fill();
}

/** Draw one named character's portrait onto a shared canvas and return the
 *  data-URL, so the dialogue HUD can stamp it straight into an <img>. */
export function drawPortrait(name) {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  const c = CHARACTER_PORTRAITS[name] || CHARACTER_PORTRAITS.Rook;
  drawBase(ctx, c);
  portraitFeatures[name]?.(ctx, c);
  return cv.toDataURL();
}

/** Name tag pinned across the chest of a portrait. */
function tag(ctx, text) {
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, 64, 126);
}

/** Rook: teal cap + flat short hair. */
function portraitRook(ctx, c) {
  ctx.fillStyle = c.hair;
  ctx.beginPath();
  ctx.arc(64, 58, 27, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#1b8a7d';
  ctx.beginPath();
  ctx.arc(64, 46, 29, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(34, 56, 60, 6);
  ctx.fillStyle = '#2b2b33';
  ctx.fillRect(34, 58, 60, 5);
  ctx.fillStyle = '#0e0e12';
  ctx.beginPath();
  ctx.arc(54, 64, 2.4, 0, Math.PI * 2);
  ctx.arc(74, 64, 2.4, 0, Math.PI * 2);
  ctx.fill();
  tag(ctx, 'ROOK');
}

/** Mama Luz: grey bun, round glasses and a shawl. */
function portraitMamaLuz(ctx, c) {
  ctx.fillStyle = '#c9c9d0';
  ctx.beginPath();
  ctx.arc(64, 52, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.hair;
  ctx.beginPath();
  ctx.arc(64, 46, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a6b52';
  ctx.beginPath();
  ctx.moveTo(28, 95); ctx.lineTo(58, 88); ctx.lineTo(52, 104); ctx.lineTo(28, 110);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(100, 95); ctx.lineTo(70, 88); ctx.lineTo(76, 104); ctx.lineTo(100, 110);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.strokeStyle = '#222';
  ctx.beginPath();
  ctx.arc(53, 64, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(75, 64, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(57, 68); ctx.lineTo(71, 68); ctx.stroke();
  tag(ctx, 'MAMA LUZ');
}

/** Tito: grease-stained cap, scruff and a rolled sleeve. */
function portraitTito(ctx, c) {
  ctx.fillStyle = '#2b2b33';
  ctx.beginPath();
  ctx.arc(64, 48, 29, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(34, 52, 60, 6);
  ctx.fillStyle = '#1a1a1f';
  ctx.fillRect(34, 54, 60, 4);
  ctx.fillStyle = '#3a3329';
  ctx.beginPath();
  ctx.arc(64, 72, 12, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#0e0e12';
  ctx.beginPath();
  ctx.arc(54, 64, 2.4, 0, Math.PI * 2);
  ctx.arc(74, 64, 2.4, 0, Math.PI * 2);
  ctx.fill();
  tag(ctx, 'TITO');
}

/** Ivy: purple hair fringe, glasses and a teal-trim jacket. */
function portraitIvy(ctx, c) {
  ctx.fillStyle = c.hair;
  ctx.beginPath();
  ctx.arc(64, 56, 29, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(34, 54, 60, 4);
  ctx.strokeStyle = c.hair;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(34, 56); ctx.quadraticCurveTo(40, 40, 64, 40);
  ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(52, 62, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(76, 62, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(46, 62); ctx.lineTo(58, 62);
  ctx.moveTo(70, 62); ctx.lineTo(82, 62);
  ctx.stroke();
  ctx.fillStyle = '#5b3a9a';
  ctx.beginPath();
  ctx.moveTo(58, 92); ctx.lineTo(100, 96); ctx.lineTo(64, 128);
  ctx.closePath(); ctx.fill();
  tag(ctx, 'IVY');
}

/** Captain Solano: police cap, moustache and a dark uniform. */
function portraitSolano(ctx, c) {
  ctx.fillStyle = '#19233f';
  ctx.beginPath();
  ctx.arc(64, 50, 30, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(33, 50, 62, 7);
  ctx.fillStyle = '#d8d2b0';
  ctx.fillRect(33, 52, 62, 3);
  ctx.fillStyle = '#0e0e12';
  ctx.beginPath();
  ctx.arc(54, 62, 2.4, 0, Math.PI * 2);
  ctx.arc(74, 62, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d8d2b0';
  ctx.fillRect(50, 64, 28, 1);
  tag(ctx, 'SOLANO');
}

/** Kestrel: gull-feather jacket and a sharp scarf. */
function portraitKestrel(ctx, c) {
  ctx.fillStyle = '#3a2a1a';
  ctx.beginPath();
  ctx.moveTo(40, 56); ctx.quadraticCurveTo(64, 44, 88, 56);
  ctx.lineTo(88, 62); ctx.lineTo(40, 62);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#c9c9d0';
  ctx.beginPath();
  ctx.moveTo(36, 60); ctx.lineTo(54, 58); ctx.lineTo(46, 84);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(92, 60); ctx.lineTo(74, 58); ctx.lineTo(82, 84);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a32d22';
  ctx.beginPath();
  ctx.moveTo(48, 84); ctx.lineTo(80, 84); ctx.lineTo(72, 96);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#0e0e12';
  ctx.beginPath();
  ctx.arc(54, 70, 2.2, 0, Math.PI * 2);
  ctx.arc(74, 70, 2.2, 0, Math.PI * 2);
  ctx.fill();
  tag(ctx, 'KESTREL');
}

/** Dispatch each named face to its feature painter. */
export const portraitFeatures = {
  Rook: portraitRook,
  'Mama Luz': portraitMamaLuz,
  Tito: portraitTito,
  Ivy: portraitIvy,
  'Captain Solano': portraitSolano,
  Kestrel: portraitKestrel,
};

// --temporary-tail-- marker for appending below