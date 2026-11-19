// LUMEN BAY title menu: big logo, tagline, judge line, buttons (CONTINUE /
// NEW GAME / CONTROLS / SETTINGS / HOW TO PLAY) and the character roster.
// Buttons are real DOM <button>s AND keyboard navigable (Enter/Space).
import { CHARACTERS } from '../missions/catalog.js';
import { drawPortrait } from '../missions/characters.js';
import { SAVE_KEY } from '../config.js';
import * as sfx from '../audio/sfx.js';

const SETTINGS_KEY = 'lumen-bay-settings';

/** Load persisted settings; missing keys fall back to the game defaults. */
export function loadSettings() {
  const base = { volume: 1, music: true, minimap: true, shake: true };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return base;
    return Object.assign(base, JSON.parse(raw));
  } catch {
    return base;
  }
}

/** Persist settings under lumen-bay-settings. */
export function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage full or blocked; ignore */
  }
}

/** Highest chapter reached from the missions list (DONE/ACTIVE), for the
 *  CONTINUE save summary. Falls back to chapter 1 on a fresh run. */
function currentChapter(state) {
  const ms = (state && state.missions) || [];
  let ch = 1;
  for (const mi of ms) {
    if (mi.status === 'DONE' || mi.status === 'ACTIVE') {
      const num = parseInt(String(mi.id).replace(/\D/g, ''), 10);
      if (Number.isFinite(num) && num > ch) ch = num;
    }
  }
  return ch;
}

/** Build the title menu inside #menu. callbacks wire the buttons:
 *  onContinue(), onNewGame(), onControls(), onSettings(settings), onHowTo().
 */
export function createMenu(state, callbacks = {}) {
  const dom = document.getElementById('menu');
  if (!dom) return () => {};

  // Read the persisted save once at build time. The menu is rebuilt on every
  // return to the title, so the save read is fresh here; this is the source
  // of truth for whether CONTINUE is available and what its summary shows.
  let saved = null;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch {
    saved = null;
  }

  const hasSave = !!saved;

  // --- keyboard nav: buttons get a roving .focused class; Enter/Space click. ---
  let focusIndex = 0;
  const buttons = [];
  // Skip disabled buttons (e.g. CONTINUE before a save exists) so the focused
  // selection only ever lands on an actionable entry.
  const focus = (i) => {
    let k = i;
    for (let guard = 0; guard < buttons.length; guard += 1) {
      focusIndex = (k + buttons.length) % buttons.length;
      const b = buttons[focusIndex];
      if (b && !b.disabled) break;
      k += i >= 0 ? 1 : -1;
    }
    buttons.forEach((b, bi) => b.classList.toggle('focused', bi === focusIndex));
    if (buttons[focusIndex]) buttons[focusIndex].focus({ preventScroll: true });
  };

  dom.style.display = 'flex';
  dom.innerHTML = '';

  const row = (label, value) =>
    `<div class="menu-row"><span class="mk">${label}</span><span class="mv">${value}</span></div>`;

  const saveSummary = hasSave
    ? (() => {
        // Format the save's clock the same way state.formatClock() does:
        // hh:mm from clockMinutes (0..minutesPerDay). Mirror it here because
        // the save is a plain object without the state method.
        let clock = '';
        if (saved && saved.clockMinutes != null) {
          const mins = Math.floor(Number(saved.clockMinutes)) % (24 * 60);
          const hh = String(Math.floor(mins / 60)).padStart(2, '0');
          const mm = String(mins % 60).padStart(2, '0');
          clock = ` \u00b7 ${hh}:${mm}`;
        }
        return row('SAVE', `Ch.${currentChapter(saved)} \u00b7 $${Number(saved.money || 0).toLocaleString()} \u00b7 Day ${saved.day || 1}${clock}`);
      })()
    : '';

  dom.innerHTML = `
    <div class="menu-panel">
      <div class="menu-logo">LUMEN <span>BAY</span></div>
      <div class="menu-tag">A sun-soaked island crime story</div>
      <div class="menu-judge">8 story missions \u00b7 traffic \u00b7 police chases \u00b7 radio \u00b7 saves</div>
      <div class="menu-judge">WASD moves Rook once in game \u2014 here use arrows + Enter, choose NEW GAME</div>
      <div class="menu-buttons">
        <button data-mb="continue"${hasSave ? '' : ' disabled'}>CONTINUE${hasSave ? `<span class="mb-sub">${saveSummary}</span>` : ''}</button>
        <button data-mb="newgame">NEW GAME</button>
        <button data-mb="controls">CONTROLS</button>
        <button data-mb="settings">SETTINGS</button>
        <button data-mb="howto">HOW TO PLAY</button>
      </div>
    </div>
    <div class="menu-roster">
      <div class="menu-roster-title">THE CREW</div>
      ${CHARACTERS.map((c) => `
        <div class="menu-char">
          <img src="${drawPortrait(c.name)}" alt="${c.name}" width="46" height="46">
          <div class="mc-txt">
            <div class="mc-name">${c.name}<span class="mc-role"> \u00b7 ${c.role}</span></div>
            <div class="mc-bio">${c.bio}</div>
          </div>
        </div>`).join('')}
    </div>
  `;

  // --menu-wire-- marker: button wiring below
  dom.querySelectorAll('button').forEach((b) => buttons.push(b));
  const onKey = (e) => {
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      focus(focusIndex + (e.code === 'ArrowDown' ? 1 : -1));
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      const b = buttons[focusIndex];
      if (b && !b.disabled) b.click();
    }
  };
  dom.addEventListener('keydown', onKey);

  const fire = (name) => {
    sfx.play('click');   // UI tick on every menu activation
    if (name === 'continue' && callbacks.onContinue) callbacks.onContinue();
    else if (name === 'newgame') callbacks.onNewGame();
    else if (name === 'controls') callbacks.onControls();
    else if (name === 'settings') callbacks.onSettings();
    else if (name === 'howto') callbacks.onHowTo();
  };

  dom.querySelectorAll('button').forEach((b) => {
    if (b.dataset.mb !== 'newgame') b.addEventListener('click', () => fire(b.dataset.mb));
  });

  // NEW GAME must confirm if a save already exists.
  dom.querySelector('[data-mb="newgame"]').addEventListener('click', () => {
    sfx.play('click');   // NEW GAME bypasses fire() for its confirm dialog
    if (hasSave) {
      const ok = window.confirm('This overwrites your current save. Start fresh?');
      if (!ok) return;
    }
    callbacks.onNewGame();
  });

  if (hasSave) focus(0);
  else focus(1);
  return function close() {
    dom.removeEventListener('keydown', onKey);
    dom.innerHTML = '';
    dom.style.display = 'none';
  };
}