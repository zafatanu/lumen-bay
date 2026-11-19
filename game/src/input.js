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
//   `jump` is the held Space field — driving.js reads it as nitro.

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
  const mouse = { x: 0, y: 0, down: false, click: false };
  let weapon = 1;

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
    mouse.down = true;
    mouse.click = true;
  }

  function onPointerUp() {
    mouse.down = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);

  // On window blur (switching tabs, clicking out) release every held key so a
  // stale "up" can't leave Rook driving into a wall or firing unattended.
  window.addEventListener('blur', () => {
    keys.up = keys.down = keys.left = keys.right = false;
    keys.sprint = keys.handbrake = keys.jump = false;
    keys.recover = false;
    mouse.down = false;
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
    clear() {
      pressed.clear();
    },
  };
}