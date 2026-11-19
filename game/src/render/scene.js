// LUMEN BAY render scene: WebGL renderer, sunset lighting, sky dome, clouds,
// and the shared canvas-texture facade helper used by city.js.
import * as THREE from 'three';
import { SUNSET, WORLD } from '../config.js';

/** Shared helper: paint a building facade (windows grid) onto a canvas texture.
 *  Deterministic: pass the city's seeded rng so the same city reproduces exactly. */
export function makeFacadeTexture(palette, floors, rng) {
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
  const lightP = 0.25;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = w * (c + 1) / (cols + 1) - winW / 2;
      const y = h * (r + 1) / (rows + 1) - winH / 2;
      const lit = rng() < lightP;
      ctx.fillStyle = lit ? '#ffd9a0' : 'rgba(20,26,38,0.82)';
      ctx.fillRect(x, y, winW, winH);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  // A dark parapet band along the top edge and a recessed door on the ground
  // floor make the box facades read as built buildings, not blank walls.
  const pctx = cv.getContext('2d');
  pctx.fillStyle = 'rgba(20,24,34,0.85)';
  pctx.fillRect(0, 0, w, h * 0.06);          // parapet
  pctx.fillRect(0, h * 0.86, w, h * 0.14);    // ground-floor plinth
  const doorW = w * 0.18;
  const doorX = (w - doorW) / 2;
  pctx.fillStyle = 'rgba(12,15,22,0.95)';
  pctx.fillRect(doorX, h * 0.78, doorW, h * 0.18);

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
  scene.fog = new THREE.Fog(SUNSET.fog, 120, 520);

  const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.5, 1600544);
  camera.position.set(0, 40, 90);
  camera.lookAt(0, 0, 0);

  // --- Sunset sky dome: big sphere with a vertex-colour gradient. ---
  // The single gradient sphere wraps the whole island, so the same dusk
  // palette tints every district and no skybox texture ever loads.
  const skyGeo = new THREE.SphereGeometry(1500, 32, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(SUNSET.skyTop) },
      midColor: { value: new THREE.Color(SUNSET.skyMid) },
      lowColor: { value: new THREE.Color(SUNSET.skyLow) },
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
      varying vec3 vWorld;
      void main() {
        float h = clamp(vWorld.y, -0.2, 1.0);
        vec3 col = h < 0.15
          ? mix(lowColor, midColor, (h + 0.2) / 0.35)
          : mix(midColor, topColor, (h - 0.15) / 0.85);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // --- Sunset lighting: warm low sun + soft hemisphere fill. ---
  const sun = new THREE.DirectionalLight(SUNSET.sun, SUNSET.sunIntensity);
  sun.position.set(-80, 18, -60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -WORLD.total * 0.7;
  sun.shadow.camera.right = WORLD.total * 0.7;
  sun.shadow.camera.top = WORLD.total * 0.7;
  sun.shadow.camera.bottom = -WORLD.total * 0.7;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(SUNSET.hemiSky, SUNSET.hemiGround, 1.1);
  scene.add(hemi);

  // --- Clouds: a few flat translucent billboards high up. ---
  const cloudGroup = new THREE.Group();
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffd9e0, transparent: true, opacity: 0.55 });
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
    hemi.intensity = THREE.MathUtils.lerp(1.1, 0.5, nightT);
    hemiColor.set(SUNSET.hemiSky).lerp(new THREE.Color(night), nightT * 0.6);
    hemi.color.copy(hemiColor);

    renderer.render(scene, camera);
  }

  function resize() {
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  return { scene, camera, update, resize, sun, hemi, skyMat };
}