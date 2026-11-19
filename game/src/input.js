// Keyboard and pointer input for LUMEN BAY.
// Held keys give movement state; one-shot presses are queued and consumed once.

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
    sprint: false, handbrake: false, interact: false, jump: false,
    honk: false, recover: false,
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
    else if (code === 'KeyF') keys.interact = true;
    else if (code === 'Space') keys.jump = true;
    else if (code === 'KeyE') keys.honk = true;
    else if (code === 'KeyR') keys.recover = true;
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
    else if (code === 'KeyF') keys.interact = false;
    else if (code === 'Space') keys.jump = false;
    else if (code === 'KeyE') keys.honk = false;
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
    keys.sprint = keys.handbrake = keys.interact = keys.jump = false;
    keys.honk = keys.recover = false;
    mouse.down = false;
  });

  return {
    snapshot() {
      return {
        up: keys.up, down: keys.down, left: keys.left, right: keys.right,
        sprint: keys.sprint, handbrake: keys.handbrake, interact: keys.interact, jump: keys.jump,
        honk: keys.honk, recover: keys.recover, weapon,
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