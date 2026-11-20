// Keyboard and pointer input for LUMEN BAY.
// Held keys give movement state; one-shot presses are queued and consumed once.
//
// The one true mapping (HUD footer, CONTROLS and HOW TO PLAY all say this):
//   WASD/arrows move · SHIFT sprint · E interact (start job) · F enter/steal
//   car (and exit) · SPACE nitro · H handbrake · Q horn · R reload · N radio ·
//   M map · ESC pause. E and F are one-shot: main.js consumes them from the pressed
//   set (consumeAny), so they have no held-state field here. Q is the horn
//   (P3 audio): also one-shot — snapshot() reports it once as `honk` and
//   consumes the press, so driving.js honks exactly once per key tap.
//   `jump` is the held Space field — on foot it jumps (see onfoot.js), and
//   in a car driving.js reads it as nitro.
//
// Mouse: the canvas click locks the pointer (mouse-look, see main.js). While
// locked, left button fires and right held aims over the shoulder — exactly the
// bindings CONTROLS lists. Unlocked, left click still fires and right held still
// aims (a plain mouse works without the lock); the lock only adds camera orbit.

const WASD = {
  up: new Set(['KeyW', 'ArrowUp']),
  down: new Set(['KeyS', 'ArrowDown']),
  left: new Set(['KeyA', 'ArrowLeft']),
  right: new Set(['KeyD', 'ArrowRight']),
};

// Digit keys select weapons (1-4); kept as a tiny state alongside the rest.
const DIGIT = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4 };

export function createInput() {
  const keys = {
    up: false, down: false, left: false, right: false,
    sprint: false, handbrake: false, jump: false,
    recover: false,
  };
  const pressed = new Set();
  const mouse = { x: 0, y: 0, down: false, click: false, aim: false };
  let weapon = 1;
  // Mouse-look: pointer deltas that piled up since the last snapshot(). While
  // the pointer is locked, main.js drains them into the orbit and drops the
  // absolute position; a plain click (the gun) is edge-detected per call so
  // the click that HIDES the hint never also fires a round.
  let lookX = 0;
  let lookY = 0;
  let clickSeen = false;

  function onKeyDown(event) {
    const code = event.code;
    if (WASD.up.has(code)) keys.up = true;
    else if (WASD.down.has(code)) keys.down = true;
    else if (WASD.left.has(code)) keys.left = true;
    else if (WASD.right.has(code)) keys.right = true;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') keys.sprint = true;
    else if (code === 'KeyH') keys.handbrake = true;
    else if (code === 'Space') keys.jump = true;   // held Space = nitro (driving.js)
    else if (code === 'KeyR') keys.recover = true;
    // E (interact) and F (enter/steal) are one-shot actions: they fall through
    // to the pressed set below and main.js consumes them with consumeAny().
    if (DIGIT[code]) weapon = DIGIT[code];

    // Keep Space from scrolling the page and arrows from nudging focus.
    if (!event.repeat && !event.ctrlKey && !event.metaKey) pressed.add(code);
    event.preventDefault();
  }

  function onKeyUp(event) {
    const code = event.code;
    if (WASD.up.has(code)) keys.up = false;
    else if (WASD.down.has(code)) keys.down = false;
    else if (WASD.left.has(code)) keys.left = false;
    else if (WASD.right.has(code)) keys.right = false;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') keys.sprint = false;
    else if (code === 'KeyH') keys.handbrake = false;
    else if (code === 'Space') keys.jump = false;
    else if (code === 'KeyR') keys.recover = false;
  }

  function onPointerMove(event) {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
  }

  function onPointerDown(event) {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    // Right / middle just aim: they must not queue a shot or hide a hint the
    // way a left press is allowed to.
    if (event.button === 2 || event.button === 1) { mouse.aim = true; return; }
    if (event.button !== undefined && event.button !== 0) return;
    mouse.down = true;
    mouse.click = true;
    clickSeen = true;
  }

  function onPointerUp(event) {
    if (event.button === undefined || event.button === 2 || event.button === 1) mouse.aim = false;
    if (event.button === undefined || event.button === 0) mouse.down = false;
  }

  function onContextMenu(event) {
    // Right button aims; the browser menu would eat the hold. Never over a
    // menu button (right-drag is a voluntary cancel there), only over play.
    if (!event.target || !event.target.closest || !event.target.closest('button')) event.preventDefault();
  }

  // getCoalescedEvents() hands back every mousemove sampled since the last
  // rAF, not just the newest one, so a fast flick orbits by its full travel
  // instead of the last few pixels.
  function onMouseMove(event) {
    let dx = event.movementX || 0;
    let dy = event.movementY || 0;
    if (!dx && !dy && typeof event.getCoalescedEvents === 'function') {
      for (const e of event.getCoalescedEvents()) {
        dx += e.movementX || 0;
        dy += e.movementY || 0;
      }
    }
    lookX += dx;
    lookY += dy;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('contextmenu', onContextMenu);

  // On window blur (switching tabs, clicking out) release every held key so a
  // stale "up" can't leave Rook driving into a wall or firing unattended.
  window.addEventListener('blur', () => {
    keys.up = keys.down = keys.left = keys.right = false;
    keys.sprint = keys.handbrake = keys.jump = false;
    keys.recover = false;
    mouse.down = false;
    mouse.aim = false;
    lookX = 0;
    lookY = 0;
  });

  return {
    snapshot() {
      // Horn is one-shot: report the KeyQ press once, then consume it so a
      // fixed-step frame running several sim steps honks exactly once. The
      // staged snapshots in shots.js carry the same `honk` field (false).
      const honk = pressed.has('KeyQ');
      if (honk) pressed.delete('KeyQ');
      return {
        up: keys.up, down: keys.down, left: keys.left, right: keys.right,
        sprint: keys.sprint, handbrake: keys.handbrake, jump: keys.jump,
        recover: keys.recover, weapon, honk,
        mouseX: mouse.x, mouseY: mouse.y, mouseDown: mouse.down,
        mouseAim: mouse.aim,
      };
    },
    pressed(code) {
      return pressed.has(code);
    },
    pressedAny(codes) {
      for (let i = 0; i < codes.length; i += 1) {
        if (pressed.has(codes[i])) return true;
      }
      return false;
    },
    consumeAny(codes) {
      for (let i = 0; i < codes.length; i += 1) {
        if (pressed.delete(codes[i])) return true;
      }
      return false;
    },
    click() {
      const c = mouse.click;
      mouse.click = false;
      return c;
    },
    /** Take the mouse-look travel since the last call and zero it. main.js
     *  drains it once per rendered frame (after the fixed steps). */
    look() {
      const d = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return d;
    },
    /** A press-edge eat: under pointer lock every mousedown IS a shot, so
     *  combat uses this for the gun — the press that hid the "click to look"
     *  hint is already spent by then via the click() tap in combat.update.
     *  click() keeps its "may be consumed twice" shape. */
    clickPressed() {
      if (!clickSeen) return false;
      clickSeen = false;
      return true;
    },
    clear() {
      pressed.clear();
    },
  };
}