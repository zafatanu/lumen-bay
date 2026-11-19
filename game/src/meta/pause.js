// LUMEN BAY pause screen (Esc): PAUSED title, RESUME / RESTART MISSION /
// SETTINGS / QUIT TO MENU buttons, plus a current-objective recap + stats.
import { MISSIONS } from '../missions/catalog.js';

/** Build the pause overlay inside #pause-screen. Returns { open, close }.
 *  callbacks: onResume, onRestart, onSettings, onQuit.
 */
export function createPause(state, callbacks = {}) {
  const dom = document.getElementById('pause-screen');
  if (!dom) return { open: () => {}, close: () => {} };

  let focusIndex = 0;
  const buttons = [];
  const focus = (i) => {
    focusIndex = (i + buttons.length) % buttons.length;
    buttons.forEach((b, bi) => b.classList.toggle('focused', bi === focusIndex));
    if (buttons[focusIndex]) buttons[focusIndex].focus({ preventScroll: true });
  };

  function open() {
    dom.innerHTML = '';
    dom.style.display = 'flex';

    const def = state.currentMission ? MISSIONS.find((m) => m.id === state.currentMission) : null;
    const obj = state.missionNext || (def ? def.title : 'Free roam');
    const stats = `Day ${state.day} \u00b7 ${state.formatClock ? state.formatClock() : ''} \u00b7 $${Number(state.money || 0).toLocaleString()} \u00b7 ${state.stars}★`;

    dom.innerHTML = `
      <div class="pause-box">
        <div class="pause-title">PAUSED</div>
        <div class="pause-obj">
          <div class="po-k">CURRENT OBJECTIVE</div>
          <div class="po-v">${obj}</div>
        </div>
        <div class="pause-stats">${stats}</div>
        <div class="pause-buttons">
          <button data-pb="resume">RESUME</button>
          <button data-pb="restart">RESTART MISSION</button>
          <button data-pb="settings">SETTINGS</button>
          <button data-pb="quit">QUIT TO MENU</button>
        </div>
      </div>
    `;
    // --pause-wire-- marker: wire buttons below
    dom.querySelectorAll('button').forEach((b) => buttons.push(b));
    const fire = (name) => {
      if (name === 'resume' && callbacks.onResume) callbacks.onResume();
      else if (name === 'restart') callbacks.onRestart();
      else if (name === 'settings') callbacks.onSettings();
      else if (name === 'quit') callbacks.onQuit();
    };
    dom.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => fire(b.dataset.pb));
    });
    const onKey = (e) => {
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        focus(focusIndex + (e.code === 'ArrowDown' ? 1 : -1));
      } else if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        const b = buttons[focusIndex];
        if (b) b.click();
      }
    };
    dom.addEventListener('keydown', onKey);
    dom._pauseKey = onKey;
    focus(0);
  }

  return { open, close: () => {
    if (dom._pauseKey) dom.removeEventListener('keydown', dom._pauseKey);
    dom.innerHTML = '';
    dom.style.display = 'none';
  } };
}