// LUMEN BAY render scene: WebGL renderer, sunset lighting, sky dome, clouds,
// and the shared canvas-texture facade helper used by city.js.
import * as THREE from 'three';
import { SUNSET, WORLD } from '../config.js';

/** Darken a '#rrggbb' colour by factor f (0..1) for painted trim/shadows. */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

// --- Ambient dressing hooks (visual only). ---
// city.js registers small per-frame updaters here (palm sway, lamp glow,
// window toggles, cruiser lightbar); update() ticks them so the city
// breathes without any gameplay system knowing about it.
const ambientUpdaters = [];
export function registerAmbient(fn) { ambientUpdaters.push(fn); }

/** Shared helper: paint a building facade (windows grid) onto a canvas texture.
 *  Deterministic: pass the city's seeded rng so the same city reproduces exactly.
 *  deco=true adds art-deco pilasters + floor bands for the showcase districts.
 *  Windows are SELECTIVE: roughly one in five lit warm, the rest dark glass. */
export function makeFacadeTexture(palette, floors, rng, deco = false) {
  const w = 256;
  const h = 512;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const wall = palette[Math.floor(rng() * palette.length)] || palette[0];
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  const cols = 4;
  const rows = Math.max(4, floors);
  const winW = w / (cols * 3);
  const winH = h / (rows * 4);

  if (deco) {
    // Vertical pilasters between the window bays and a slim spandrel band
    // under each floor: pastel art-deco rhythm, painted not neon.
    ctx.fillStyle = shade(wall, 0.82);
    for (let c = 0; c <= cols; c += 1) {
      const x = w * (c + 0.5) / (cols + 1);
      ctx.fillRect(x - 3, 0, 6, h);
    }
    ctx.fillStyle = shade(wall, 0.9);
    for (let r = 1; r < rows; r += 1) {
      const y = h * (r + 0.5) / (rows + 1);
      ctx.fillRect(0, y, w, 3);
    }
  }

  const lightP = 0.22;
  // Remember the toggleable window rects (clear of the parapet, plinth and
  // door overlays painted below) so ambient dressing can flip a few lights.
  const windows = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = w * (c + 1) / (cols + 1) - winW / 2;
      const y = h * (r + 1) / (rows + 1) - winH / 2;
      const lit = rng() < lightP;
      ctx.fillStyle = lit ? (rng() < 0.5 ? '#ffc978' : '#ffe3b0') : 'rgba(24,28,44,0.85)';
      ctx.fillRect(x, y, winW, winH);
      if (y > h * 0.06 && y + winH < h * 0.76) windows.push({ x, y, lit });
      if (deco) {
        // A small sill under each window sells the painted depth.
        ctx.fillStyle = shade(wall, 0.75);
        ctx.fillRect(x - 2, y + winH, winW + 4, 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.windows = windows;
  tex.userData.winW = winW;
  tex.userData.winH = winH;
  tex.userData.wall = wall;

  // A dark parapet band along the top edge and a recessed door on the ground
  // floor make the box facades read as built buildings, not blank walls.
  const pctx = cv.getContext('2d');
  pctx.fillStyle = 'rgba(20,24,34,0.85)';
  pctx.fillRect(0, 0, w, h * 0.06);          // parapet
  pctx.fillRect(0, h * 0.86, w, h * 0.14);    // ground-floor plinth
  if (deco) {
    // Stepped crown motif in the parapet: three raised tabs, deco skyline.
    pctx.fillStyle = shade(wall, 0.7);
    pctx.fillRect(w * 0.18, 0, w * 0.12, h * 0.045);
    pctx.fillRect(w * 0.44, 0, w * 0.12, h * 0.06);
    pctx.fillRect(w * 0.70, 0, w * 0.12, h * 0.045);
  }
  const doorW = w * 0.18;
  const doorX = (w - doorW) / 2;
  pctx.fillStyle = 'rgba(12,15,22,0.95)';
  pctx.fillRect(doorX, h * 0.78, doorW, h * 0.18);
  if (deco) {
    // Warm transom over the door: one lit entry, not a neon strip.
    pctx.fillStyle = 'rgba(255,201,120,0.9)';
    pctx.fillRect(doorX, h * 0.76, doorW, h * 0.02);
  }

  return tex;
}

/** Build renderer, sunset sky dome, lights, fog and clouds. Returns update(). */
export function createRenderer3D(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(SUNSET.fog);

  const scene = new THREE.Scene();
  // Moderate haze: depth cue between the camera and the far districts, but
  // the island (578m) stays fully readable — no fog-out.
  scene.fog = new THREE.Fog(SUNSET.fog, SUNSET.fogNear, SUNSET.fogFar);

  const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.5, 1600544);
  camera.position.set(0, 40, 90);
  camera.lookAt(0, 0, 0);

  // --- Sunset sky dome: big sphere with a vertex-colour gradient. ---
  // The single gradient sphere wraps the whole island, so the same dusk
  // palette tints every district and no skybox texture ever loads. A cheap
  // analytic glow + disc puts the low sun on the ocean horizon.
  const sunDir = new THREE.Vector3(SUNSET.sunPos.x, SUNSET.sunPos.y, SUNSET.sunPos.z).normalize();
  const skyGeo = new THREE.SphereGeometry(1500, 32, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(SUNSET.skyTop) },
      midColor: { value: new THREE.Color(SUNSET.skyMid) },
      lowColor: { value: new THREE.Color(SUNSET.skyLow) },
      sunDir: { value: sunDir },
      glowColor: { value: new THREE.Color(SUNSET.sunGlow) },
      glowStrength: { value: 1.0 },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = normalize(wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 midColor; uniform vec3 lowColor;
      uniform vec3 sunDir; uniform vec3 glowColor; uniform float glowStrength;
      varying vec3 vWorld;
      void main() {
        float h = clamp(vWorld.y, -0.2, 1.0);
        vec3 col = h < 0.15
          ? mix(lowColor, midColor, (h + 0.2) / 0.35)
          : mix(midColor, topColor, (h - 0.15) / 0.85);
        // Warm halo around the sun: broad haze + tight core, then the disc.
        float s = max(dot(normalize(vWorld), sunDir), 0.0);
        col += glowColor * (pow(s, 24.0) * 0.5 + pow(s, 160.0) * 0.85) * glowStrength;
        float disc = smoothstep(0.9993, 0.9997, s);
        col = mix(col, vec3(1.0, 0.87, 0.62), disc * glowStrength);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // --- Sunset lighting: warm low key over the ocean + cool violet fill. ---
  // Sun sits ~7 deg above the horizon, ~6 deg off the ocean centre (config).
  const sun = new THREE.DirectionalLight(SUNSET.sun, SUNSET.sunIntensity);
  sun.position.set(SUNSET.sunPos.x, SUNSET.sunPos.y, SUNSET.sunPos.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -WORLD.total * 0.7;
  sun.shadow.camera.right = WORLD.total * 0.7;
  sun.shadow.camera.top = WORLD.total * 0.7;
  sun.shadow.camera.bottom = -WORLD.total * 0.7;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(SUNSET.hemiSky, SUNSET.hemiGround, 1.0);
  scene.add(hemi);

  // Cool blue bounce from the opposite side so shadowed facades read violet,
  // not black. No shadow map — it is fill only.
  const fill = new THREE.DirectionalLight(SUNSET.fill, SUNSET.fillIntensity);
  fill.position.set(120, 70, 90);
  scene.add(fill);
  scene.add(fill.target);

  // --- Clouds: a few flat translucent billboards high up, dusk-tinted. ---
  const cloudGroup = new THREE.Group();
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffc9a8, transparent: true, opacity: 0.5 });
  for (let i = 0; i < 10; i += 1) {
    const cw = 60 + Math.random() * 120;
    const cd = 12 + Math.random() * 24;
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), cloudMat);
    c.scale.set(cw, 3 + Math.random() * 5, cd);
    c.position.set((Math.random() - 0.5) * WORLD.total * 2, 120 + Math.random() * 40, (Math.random() - 0.5) * WORLD.total * 2);
    cloudGroup.add(c);
  }
  scene.add(cloudGroup);

  // --- Player spawn marker (replaced by the actual player later). ---
  let time = 0;
  // The ocean plane is built by city.js under this name; grab it once.
  let ocean = null;

  // Day/night transition: minutes from start (17:40) to midnight toward 06:00.
  // t goes 0 at 17:40 to 1 at 06:00 (next morning) → night creeps in.
  const sunColor = new THREE.Color(SUNSET.sun);
  const hemiColor = new THREE.Color(SUNSET.hemiSky);

  function update(dt, clockMinutes) {
    time += dt;
    cloudGroup.position.x = (time * 1.2) % (WORLD.total * 4) - WORLD.total * 2;

    // Blend sunset light toward night as the clock moves past ~20:00.
    const minutes = clockMinutes || 17 * 60 + 40;
    const nightT = THREE.MathUtils.clamp((minutes - 20 * 60) / (6 * 60), 0, 1);
    const night = SUNSET.nightSky;
    const nightIntensity = THREE.MathUtils.lerp(SUNSET.sunIntensity, SUNSET.nightSunIntensity, nightT);
    sunColor.set(SUNSET.sun).lerp(new THREE.Color(night), nightT);
    sun.intensity = nightIntensity;
    sun.color.copy(sunColor);
    hemi.intensity = THREE.MathUtils.lerp(1.0, 0.5, nightT);
    hemiColor.set(SUNSET.hemiSky).lerp(new THREE.Color(night), nightT * 0.6);
    hemi.color.copy(hemiColor);
    // The sun disc/halo and the cool bounce fade with the key light so the
    // night creep stays one continuous identity, not a second palette.
    skyMat.uniforms.glowStrength.value = THREE.MathUtils.lerp(1.0, 0.12, nightT);
    fill.intensity = THREE.MathUtils.lerp(SUNSET.fillIntensity, 0.22, nightT);

    // Gentle ocean motion: a slow vertex swell on the ocean plane plus a
    // faint roughness breathe, so the low sun's specular glint shifts like
    // moving water. Same surface height, same palette — no new lights.
    if (!ocean) ocean = scene.getObjectByName('ocean');
    if (ocean) {
      const pos = ocean.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        pos.setZ(i, Math.sin(x * 0.08 + time * 0.7) * 0.1
          + Math.cos(y * 0.05 + time * 0.45) * 0.1);
      }
      pos.needsUpdate = true;
      ocean.geometry.computeVertexNormals();
      ocean.material.roughness = 0.15 + Math.sin(time * 0.4) * 0.04;
    }

    // Ambient city dressing (palm sway, lamps, windows, cruiser lightbar).
    for (const fn of ambientUpdaters) fn(time, dt);

    renderer.render(scene, camera);
  }

  function resize() {
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  return { scene, camera, update, resize, sun, hemi, fill, skyMat };
}