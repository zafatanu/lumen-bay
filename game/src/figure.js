// LUMEN BAY shared figure rig: limbs hung from hip/shoulder pivots and the
// walk cycle that swings them. Factored out of the pedestrian pattern in
// vehicles/traffic.js (limb() + animatePed()) so Rook and the enemy crews
// walk with the same gait instead of standing rigid. Visual only: nothing
// here ever touches position, heading, collision or AI state.
import * as THREE from 'three';

/** Radians of gait phase per metre travelled: a full stride cycle (two
 *  steps) spans ~2.9m, so the cycle speeds up with the figure, not a timer. */
export const STRIDE = 2.2;

/** Hang a limb mesh from a pivot at (x, y) on `group`, exactly like the
 *  pedestrian limb() helper: the mesh sits len/2 below the pivot, so
 *  pivot.rotation.x swings the limb about the joint. */
export function limb(group, x, y, geo, mat, len) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -len / 2;
  pivot.add(m);
  group.add(pivot);
  return pivot;
}

/** Pose one frame of the walk cycle on a figure's pivot limbs.
 *  `phase` is the gait angle (advance it by speed * dt * STRIDE); `amp` is
 *  an eased 0..1 gait amount — at 0 every limb settles back to neutral, so
 *  a stopping figure never freezes mid-stride. Legs swing ±0.5 rad, arms
 *  counter-swing at 0.8x, the head bobs a few cm with the steps and the
 *  torso counter-sways.
 *  Rig contract (see buildPlayerMesh / buildEnemyMesh): limbs hang straight
 *  down at rest, and the head pivot carries userData.baseY (its rest height)
 *  so the bob always returns to the right spot. Only rotation.x / head.y /
 *  torso y-z are written, so a posed figure (e.g. the seated driver) keeps
 *  any other rest transforms it was given. */
export function swingWalk(limbs, phase, amp) {
  const s = Math.sin(phase) * 0.5 * amp;
  limbs.legL.rotation.x = s;
  limbs.legR.rotation.x = -s;
  limbs.armL.rotation.x = -s * 0.8;
  limbs.armR.rotation.x = s * 0.8;
  if (limbs.head) {
    limbs.head.position.y = limbs.head.userData.baseY + Math.abs(Math.sin(phase)) * 0.035 * amp;
  }
  if (limbs.body) {
    limbs.body.rotation.y = -s * 0.2;
    limbs.body.rotation.z = -s * 0.08;
  }
}
