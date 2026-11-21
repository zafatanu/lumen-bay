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
// Mouse: the canvas press locks the pointer (mouse-look, see main.js) and that
// grab never fires — a second click drops the lock, so re-locking takes a new
// press. While locked, left button fires (once per press), right held aims over
// the shoulder and the mouse turns the camera — exactly the bindings CONTROLS
// lists. Without the lock the look travel is ignored (a free cursor would
// otherwise whip the camera on every menu trip); there the pointer-contact aim
// still picks the heading (combat.aimHeading's camera-forward fallback).

const WASD = {
  up: new Set(['KeyW', 'ArrowUp']),
  down: new Set(['KeyS', 'ArrowDown']),
  left: new Set(['KeyA', 'ArrowLeft']),
  right: new Set(['KeyD', 'ArrowRight']),
};

// Digit keys select weapons (1-4); kept as a tiny state alongside the rest.
const DIGIT = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4 };

export function createInput(inputCanvasIn) {
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
  // Locked-pointer presses: this flag is the queued press EDGE (one per press,
  // fired by combat, cleared by click()); a press that starts unlocked queues
  // none in onPointerDown, so nothing can go stale into the first locked press.
  let clickSeen = false;
  // The grab: true from the press that TOOK the lock until that same press is
  // released. While it holds, a locked press is that grab (it never queues the
  // next edge); the first press STARTED under the lock is the real round.
  let lockHeld = false;
  // A press is a shot, not a look, until the pointer travels: a plain click
  // must never nudge the camera, only a drag/lock turn may.
  let dragX = 0;
  let dragY = 0;
  let dragging = false;
  // The play canvas (main.js hands it in): pointer-lock owner + lock lookup.
  const inputCanvas = inputCanvasIn || document.getElementById('world3d');

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
    dragX = event.clientX;
    dragY = event.clientY;
    dragging = false;
    // Right / middle just aim: they must not queue a shot or hide a hint the
    // way a left press is allowed to.
    if (event.button === 2 || event.button === 1) { mouse.aim = true; return; }
    if (event.button !== undefined && event.button !== 0) return;
    mouse.down = true;
    // Grabs stay off the trigger: the press that asks for the lock (unlocked)
    // queues no edge itself, and the lock landing on it can queue none either —
    // the first edge only comes from a press made while the pointer is locked
    // and no grab still holds it. That first locked press hands the lock back
    // to the browser (the toggle gesture would otherwise shoot on re-acquire),
    // and its own edge fires one round; the next lock gets a clean press.
    const grab = !document.pointerLockElement || lockHeld;
    if (grab) { lockHeld = true; return; }
    mouse.click = true;
    clickSeen = true;
  }

  function onPointerUp(event) {
    if (event.button === undefined || event.button === 2 || event.button === 1) mouse.aim = false;
    if (event.button === undefined || event.button === 0) {
      mouse.down = false;
      // The grab hold lives and dies with its press: the release that follows
      // hands the lock back, and the next locked press is a fresh round.
      lockHeld = false;
    }
    dragging = false;
    dragX = event.clientX;
    dragY = event.clientY;
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
    // Locked: the browser's movementX/Y is the true travel for the frame.
    // Unlocked: only a LEFT-BUTTON DRAG steers — a plain mouse move, and the
    // press that fires a round, feed the look nothing.
    if (!document.pointerLockElement && !dragging) return;
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

  // A press that took the lock in onPointerDown already holds the grab. A lock
  // change from a press that started unlocked is either that grab landing after
  // the press (main.js never arms it for that grab) — no edge was queued
  // then, so any edge pending here is a real locked press and the hold lifts —
  // or a stray enter-decision landing in a later task: by then the press has
  // released (hold lifted), so its edge is the grab's and is dropped, the hold
  // standing so the next press is still the first round.
  function onPointerLockChange() {
    if (!document.pointerLockElement) return;
    if (clickSeen) {
      clickSeen = false;
      mouse.click = false;
      lockHeld = true;
    }
  }
  document.addEventListener('pointerlockchange', onPointerLockChange);

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
    /** The plain press queue (unlocked), and the pending press edge itself: a
     *  locked non-auto gun reads THIS, and consumes it with clickPressed(). The
     *  melee branch reads click() alone but still burns the edge here, so a
     *  swing can never be replayed as a gun round. */
    click() {
      const c = mouse.click;
      mouse.click = false;
      clickSeen = false;
      return c;
    },
    /** Take the mouse-look travel since the last call; travel only
     *  steers the camera while the pointer is locked; released, it is
     *  dropped so the last few pixels of a drag never jump the view.
     *  main.js drains it once per rendered frame (after the fixed steps). */
    look() {
      const d = document.pointerLockElement ? { x: lookX, y: lookY } : { x: 0, y: 0 };
      lookX = 0;
      lookY = 0;
      return d;
    },
    /** True while a canvas owns the pointer (mouse-look is on). */
    locked() {
      const el = document.pointerLockElement;
      return !!el && el === inputCanvas;
    },
    /** A press-edge eat for the gun under the lock: the edge a locked press
     *  queued in onPointerDown. An unlocked press queues none, so this is false
     *  until the pointer locks — and true for the FIRST press after it locks. */
    clickPressed() {
      if (!document.pointerLockElement) return false;
      if (clickSeen) {
        clickSeen = false;
        return true;
      }
      return false;
    },
    clear() {
      pressed.clear();
    },
  };
}