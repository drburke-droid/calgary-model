// Calgary, a working model — interactive viewer. three.js r160.
// Coordinates: x = east (km), y = up (km, terrain heights exaggerated), z = south (km). Time: fractional years.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);
// model data lives in data/ next to this file; if the files were uploaded flat (e.g. dragged into a GitHub repo
// without their folder), use the folder this file is in instead
const DATA = await (async () => {
  const sub = new URL('data/', import.meta.url).href, flat = new URL('./', import.meta.url).href;
  if (window.__B64DATA) return sub;
  try { const r = await fetch(sub + 'meta.json', { method: 'HEAD', cache: 'no-store' }); if (r.ok) return sub; } catch (e) { }
  try { const r = await fetch(flat + 'meta.json', { method: 'HEAD', cache: 'no-store' }); if (r.ok) return flat; } catch (e) { }
  return sub;
})();
const FILES = 17; let nLoaded = 0;
function tick(msg) { nLoaded++; $('lbar').style.width = Math.min(100, (100 * nLoaded) / FILES) + '%'; $('lmsg').textContent = msg; }
async function getBin(name) {   // binary model data (or base64 text where the host serves only text types)
  if (window.__B64DATA) {
    const r = await fetch(DATA + name + '.b64.txt'); if (!r.ok) throw new Error(name + ' ' + r.status);
    const s = atob((await r.text()).trim()); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); tick(name); return u.buffer;
  }
  const r = await fetch(DATA + name); if (!r.ok) throw new Error(name + ' ' + r.status); const b = await r.arrayBuffer(); tick(name); return b;
}
async function getJSON(name) { const r = await fetch(DATA + name); if (!r.ok) throw new Error(name + ' ' + r.status); const j = await r.json(); tick(name); return j; }
function getTex(name, srgb = false) {
  return new Promise((res, rej) => new THREE.TextureLoader().load(DATA + name, (t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.generateMipmaps = srgb; t.minFilter = srgb ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; tick(name); res(t);
  }, undefined, () => rej(new Error(name))));
}

const coarse = matchMedia('(pointer: coarse)').matches;
const lowPower = coarse && Math.min(screen.width, screen.height) < 900;

// ---------------------------------------------------------------- load
const meta = await getJSON('meta.json');
const [terrainBuf, smallBuf, bigBuf, waterBuf, treesBuf, lmBuf, lmMeta, trBuf, trMeta, streets, tRoads, tDRoads, tHalo, tWet, tFoot, tGround] = await Promise.all([
  getBin('terrain.u16'), getBin('small.bin'), getBin('big.bin'), getBin('water.bin'), getBin('trees.bin'), getBin('landmarks.bin'), getJSON('landmarks.json'),
  getBin('tracks.bin'), getJSON('tracks.json'), getJSON('streets.json'), getTex('roads.png'), getTex('droads.png'), getTex('halo.png'), getTex('wet.png'), getTex('bfoot.png'), getTex('ground.jpg', true)]);

const M = meta, TR = meta.terrain;
const wx = (X) => (X - M.XC) / 1000, wz = (Y) => -(Y - M.YC) / 1000, wy = (h) => ((h - M.HB) * M.EX) / 1000;
const qX = (q) => M.X0 + (q / 65535) * M.TW, qY = (q) => M.TY0 + (q / 65535) * M.TH;
const yr16 = (v) => (v === 65535 ? 1e4 : 1800 + v / 250);
const hq = new Uint16Array(terrainBuf); const HM = new Float32Array(hq.length);
for (let i = 0; i < hq.length; i++) HM[i] = TR.hmin + (hq[i] / 65535) * (TR.hmax - TR.hmin);
function hAt(X, Y) {   // terrain height (m) under map point, bilinear on the 48 m grid (matches the mesh)
  let c = (X - TR.x0) / TR.step, r = (TR.y0 - Y) / TR.step;
  c = Math.min(Math.max(c, 0), TR.nx - 1.001); r = Math.min(Math.max(r, 0), TR.ny - 1.001);
  const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0, i = r0 * TR.nx + c0;
  return (HM[i] * (1 - fc) + HM[i + 1] * fc) * (1 - fr) + (HM[i + TR.nx] * (1 - fc) + HM[i + TR.nx + 1] * fc) * fr;
}

// ---------------------------------------------------------------- renderer, scene, camera
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
const POST = renderer.capabilities.isWebGL2 && !/[?&]simple\b/.test(location.search);   // WebGL2: post-processed miniature look; else plain ACES
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = POST ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !lowPower; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.005, 600);
const controls = new MapControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.09; controls.zoomToCursor = true; controls.screenSpacePanning = false;
controls.minDistance = 0.12; controls.maxDistance = 75; controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
const U = { uYear: { value: 1900 }, uGlow: { value: 0 }, uGlowStart: { value: 1900 }, uFar: { value: 0 }, uRad: { value: 1e9 }, uCen: { value: new THREE.Vector2() }, uTime: { value: 0 } };

// lights: warm low sun from the west-north-west (as in the film), cool sky fill
const sun = new THREE.DirectionalLight(0xfff0d8, POST ? 3.0 : 2.5); const SUN_DIR = new THREE.Vector3(-0.742, 0.574, -0.346).normalize();
sun.castShadow = !lowPower; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.0;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xcfe0ff, POST ? 0.35 : 0.55); fill.position.set(0.6, 0.5, 0.7); scene.add(fill);
scene.add(new THREE.HemisphereLight(0xe4ecff, 0x2b2722, POST ? 0.3 : 0.85));

// shared GLSL
const GLSL_YEAR = `float yrOf(float b){ float k = b * 255.0; return k > 254.5 ? 1e4 : 1880.0 + k / 1.74; }`;
let patchId = 0;
function patch(mat, { vert = {}, frag = {}, uniforms = {} }) {   // inject code into a built-in material
  const key = 'patch' + patchId++; mat.customProgramCacheKey = () => key;   // each patched material gets its own shader program
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, uniforms);
    for (const [k, v] of Object.entries(vert)) sh.vertexShader = k === 'head' ? v + '\n' + sh.vertexShader : sh.vertexShader.replace(k, v);
    for (const [k, v] of Object.entries(frag)) sh.fragmentShader = k === 'head' ? v + '\n' + sh.fragmentShader : sh.fragmentShader.replace(k, v);
  };
  return mat;
}

// ---------------------------------------------------------------- terrain (felt, baseplate, roads by year)
{
  const nx = TR.nx, ny = TR.ny, n = nx * ny; const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const i = r * nx + c, X = TR.x0 + c * TR.step, Y = TR.y0 - r * TR.step;
    pos[i * 3] = wx(X); pos[i * 3 + 1] = wy(HM[i]); pos[i * 3 + 2] = wz(Y); uv[i * 2] = (X - M.X0) / M.TW; uv[i * 2 + 1] = (Y - M.TY0) / M.TH;
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6); let k = 0;
  for (let r = 0; r < ny - 1; r++) for (let c = 0; c < nx - 1; c++) { const a = r * nx + c, b = a + 1, d = a + nx, e = d + 1; idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aUv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
  const R = M.roads, DR = M.droads;
  const dbox = new THREE.Vector4((DR.x0 - M.X0) / M.TW, (DR.y0 - M.TY0) / M.TH, (DR.x1 - M.X0) / M.TW, (DR.y1 - M.TY0) / M.TH);
  const mat = patch(new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0 }), {
    uniforms: { tRoads: { value: tRoads }, tDRoads: { value: tDRoads }, tHalo: { value: tHalo }, tWet: { value: tWet }, tFoot: { value: tFoot }, tGround: { value: tGround },
      uDBox: { value: dbox }, uMap: { value: new THREE.Vector4(M.X0, M.TY0, M.TW, M.TH) } },
    vert: { head: 'attribute vec2 aUv; varying vec2 vTUv;', '#include <begin_vertex>': '#include <begin_vertex>\n vTUv = aUv;' },
    frag: {
      head: `uniform float uYear, uGlow, uGlowStart, uFar, uRad; uniform vec2 uCen; uniform sampler2D tRoads, tDRoads, tHalo, tWet, tFoot, tGround; uniform vec4 uDBox, uMap; varying vec2 vTUv; ${GLSL_YEAR}`,
      'vec4 diffuseColor = vec4( diffuse, opacity );': `
        vec3 col = mix(texture2D(tGround, vTUv).rgb, vec3(0.028, 0.036, 0.036), 0.72);
        vec4 hs = texture2D(tHalo, vTUv); float hy = yrOf(hs.r);
        col = mix(col, vec3(0.215, 0.205, 0.19), hs.g * smoothstep(hy, hy + 2.0, uYear) * 0.92);
        vec4 ws = texture2D(tWet, vTUv); float wyr = yrOf(ws.r);
        col = mix(col, vec3(0.02, 0.16, 0.42), ws.g * smoothstep(wyr + 0.3, wyr + 2.0, uYear));
        vec4 bf = texture2D(tFoot, vTUv); float bs = yrOf(bf.g), be = yrOf(bf.b);
        float alive = smoothstep(bs, bs + 0.8, uYear) * (1.0 - smoothstep(be, be + 0.8, uYear));
        vec2 mp = uMap.xy + vTUv * uMap.zw;
        float farv = max(uFar, smoothstep(uRad * 0.85, uRad, distance(mp, uCen)));
        col = mix(col, vec3(0.80, 0.42, 0.33), bf.r * alive * farv * 0.85);
        vec2 du = (vTUv - uDBox.xy) / (uDBox.zw - uDBox.xy);
        float ef = smoothstep(0.0, 0.03, min(min(du.x, 1.0 - du.x), min(du.y, 1.0 - du.y)));
        vec4 rs = texture2D(tRoads, vTUv); vec4 ds = texture2D(tDRoads, clamp(du, 0.0, 1.0));
        float cov = mix(rs.r, ds.r, ef), cls = mix(rs.g, ds.g, ef);
        float tp = yrOf(mix(rs.b, ds.b, ef * step(0.01, ds.r)));
        float age = uYear - tp;
        float on = cov * smoothstep(-0.05, 0.0, age);
        float heat = on * (1.0 - clamp(age / 2.5, 0.0, 1.0)) * uGlow * step(uGlowStart, tp);
        vec3 asph = mix(vec3(0.50, 0.48, 0.44), vec3(0.80, 0.74, 0.60), cls);
        vec3 hot = mix(vec3(0.95, 0.24, 0.03), vec3(1.0, 0.86, 0.55), smoothstep(0.6, 1.0, heat));
        col = mix(col, mix(asph, hot, smoothstep(0.0, 0.45, heat)), on);
        vec3 gRoadGlow = hot * pow(heat, 1.6) * 2.2;
        vec4 diffuseColor = vec4(col, opacity);`,
      'vec3 totalEmissiveRadiance = emissive;': 'vec3 totalEmissiveRadiance = emissive + gRoadGlow;',
    },
  });
  const terrain = new THREE.Mesh(g, mat); terrain.receiveShadow = true; terrain.name = 'terrain'; scene.add(terrain);
  // diorama sides: layered-cake strata and a wooden plinth
  const yb = wy(TR.hmin) - 0.55; const bands = [[0.55, 0.20, 0.10], [0.85, 0.55, 0.20], [0.95, 0.80, 0.45], [0.50, 0.30, 0.18], [0.80, 0.45, 0.30], [0.96, 0.88, 0.62], [0.35, 0.22, 0.14], [0.20, 0.32, 0.12]];
  const sp = [], sc = [], si = [];
  const edges = [[...Array(nx).keys()].map((c) => c), [...Array(ny).keys()].map((r) => r * nx + nx - 1), [...Array(nx).keys()].map((c) => (ny - 1) * nx + nx - 1 - c), [...Array(ny).keys()].map((r) => (ny - 1 - r) * nx)];
  const NB = 24;
  for (const e of edges) for (let j = 0; j < e.length; j++) {
    const i = e[j], top = pos[i * 3 + 1];
    for (let b = 0; b <= NB; b++) {
      const yy = top + (yb - top) * (b / NB); sp.push(pos[i * 3], yy, pos[i * 3 + 2]);
      const f = Math.min(0.999, Math.max(0, (yy - yb) / (wy(TR.hmax) - yb))); const c = bands[Math.floor((1 - f) * bands.length) % bands.length];
      sc.push(...c);
    }
    if (j > 0) { const base = sp.length / 3 - 2 * (NB + 1); for (let b = 0; b < NB; b++) { const a = base + b, d = base + NB + 1 + b; si.push(a, d, a + 1, a + 1, d, d + 1); } }
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3)); sg.setIndex(si); sg.computeVertexNormals();
  scene.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide })));
  const W = M.TW / 1000, H = M.TH / 1000;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.9, H + 0.9), new THREE.MeshStandardMaterial({ color: 0x5e341a, roughness: 0.35, metalness: 0.05 }));
  plinth.position.set(0, yb - 0.45, 0); plinth.receiveShadow = true; scene.add(plinth);
}

// ---------------------------------------------------------------- shared instancing helpers
const RISE = `float riseOf(vec2 Y, float dur){ float r = clamp((uYear - Y.x) / dur, 0.0, 1.0); return 1.0 - pow(1.0 - r, 3.0); }`;
function depthTwin(material, vertHead, beginVertex) {   // shadow-casting material with the same vertex animation
  const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patch(dm, { vert: { head: vertHead, '#include <begin_vertex>': beginVertex } }); return dm;
}

// ---------------------------------------------------------------- small buildings (toy houses / boxes)
const sbChunks = [];
{
  const n = M.small.n; let o = 0; const take = (T, len) => { const a = new T(smallBuf, o, len); o += len * T.BYTES_PER_ELEMENT; return a; };
  const qx = take(Uint16Array, n), qy = take(Uint16Array, n), ys = take(Uint16Array, n), ye = take(Uint16Array, n);
  const qw = take(Uint8Array, n), qd = take(Uint8Array, n), qh = take(Uint8Array, n), qa = take(Uint8Array, n), pk = take(Uint8Array, n);
  const P = new Float32Array(n * 3), S = new Float32Array(n * 3), A = new Float32Array(n), Y = new Float32Array(n * 2), C = new Uint8Array(n * 8);
  const wp = M.small.wpal, rp = M.small.rpal;
  for (let i = 0; i < n; i++) {
    const X = qX(qx[i]), Yy = qY(qy[i]);
    P[i * 3] = wx(X); P[i * 3 + 1] = wy(hAt(X, Yy)); P[i * 3 + 2] = wz(Yy);
    S[i * 3] = (qw[i] / 4) * M.FEX / 1000; S[i * 3 + 1] = (qd[i] / 4) * M.FEX / 1000; S[i * 3 + 2] = (qh[i] / 4) * M.HEX / 1000;
    A[i] = (qa[i] / 256) * Math.PI; Y[i * 2] = yr16(ys[i]); Y[i * 2 + 1] = yr16(ye[i]);
    const p = pk[i], w = wp[(p >> 1) & 15] || wp[0], r = rp[(p >> 5) & 7] || rp[0];
    C[i * 8] = w[0] * 255; C[i * 8 + 1] = w[1] * 255; C[i * 8 + 2] = w[2] * 255; C[i * 8 + 3] = (p & 1) * 255;
    C[i * 8 + 4] = r[0] * 255; C[i * 8 + 5] = r[1] * 255; C[i * 8 + 6] = r[2] * 255;
  }
  // toy house: walls to 0.62, gable roof to 1.0 (ridge along x); unit footprint
  const v = [], roof = [];
  const quad = (a, b, c, d, rf) => { v.push(...a, ...b, ...c, ...a, ...c, ...d); for (let k = 0; k < 6; k++) roof.push(rf); };
  const tri = (a, b, c, rf) => { v.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) roof.push(rf); };
  const h0 = 0.62;
  quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, h0, 0.5], [-0.5, h0, 0.5], 0); quad([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, h0, -0.5], [0.5, h0, -0.5], 0);
  quad([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, h0, -0.5], [0.5, h0, 0.5], 0); quad([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, h0, 0.5], [-0.5, h0, -0.5], 0);
  tri([0.5, h0, 0.5], [0.5, h0, -0.5], [0.5, 0.98, 0], 0); tri([-0.5, h0, -0.5], [-0.5, h0, 0.5], [-0.5, 0.98, 0], 0);
  quad([-0.58, 0.58, 0.6], [0.58, 0.58, 0.6], [0.58, 1.0, 0], [-0.58, 1.0, 0], 1); quad([0.58, 0.58, -0.6], [-0.58, 0.58, -0.6], [-0.58, 1.0, 0], [0.58, 1.0, 0], 1);
  tri([-0.58, 0.58, 0.6], [-0.58, 1.0, 0], [-0.58, 0.58, -0.6], 1); tri([0.58, 0.58, -0.6], [0.58, 1.0, 0], [0.58, 0.58, 0.6], 1);
  const house = new THREE.BufferGeometry(); house.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); house.setAttribute('aRoof', new THREE.Float32BufferAttribute(roof, 1));
  const head = `attribute vec3 iP, iS; attribute float iA; attribute vec2 iY; attribute vec4 iW, iR; attribute float aRoof; uniform float uYear; varying vec3 vCol; ${RISE}`;
  const begin = `
    float r = riseOf(iY, 0.9); float gone = smoothstep(iY.y, iY.y + 0.6, uYear);
    float vis = uYear >= iY.x ? r * (1.0 - gone) : 0.0;
    vec3 p = position; if (iW.a < 0.5 && p.y > 0.55) p.y = 1.0;
    p.x *= iS.x; p.z *= iS.y; p.y *= iS.z * vis;
    float c = cos(iA), s = sin(iA);
    vec3 transformed = vis > 0.002 ? vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + iP : iP;
    vCol = mix(mix(iW.rgb, iR.rgb, aRoof), vec3(1.0, 0.82, 0.55), (1.0 - r) * 0.75);`;
  const mat = patch(new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0, flatShading: true, side: THREE.DoubleSide }), {
    vert: { head, '#include <begin_vertex>': begin },
    frag: { head: 'varying vec3 vCol;', 'vec4 diffuseColor = vec4( diffuse, opacity );': 'vec4 diffuseColor = vec4( vCol, opacity );' },
  });
  const dmat = depthTwin(mat, head, begin);
  for (const [s0, s1, cx, cz] of M.small.chunks) {
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', house.getAttribute('position')); g.setAttribute('aRoof', house.getAttribute('aRoof'));
    const m = s1 - s0;
    g.setAttribute('iP', new THREE.InstancedBufferAttribute(P.subarray(s0 * 3, s1 * 3), 3)); g.setAttribute('iS', new THREE.InstancedBufferAttribute(S.subarray(s0 * 3, s1 * 3), 3));
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(A.subarray(s0, s1), 1)); g.setAttribute('iY', new THREE.InstancedBufferAttribute(Y.subarray(s0 * 2, s1 * 2), 2));
    g.instanceCount = m;
    const ib = new THREE.InstancedInterleavedBuffer(C.subarray(s0 * 8, s1 * 8), 8, 1);
    g.setAttribute('iW', new THREE.InterleavedBufferAttribute(ib, 4, 0, true)); g.setAttribute('iR', new THREE.InterleavedBufferAttribute(ib, 4, 4, true));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 0.5, cz), 3.4);
    const mesh = new THREE.Mesh(g, mat); mesh.customDepthMaterial = dmat; mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.c = new THREE.Vector3(cx, 0, cz); scene.add(mesh); sbChunks.push(mesh);
  }
}

// ---------------------------------------------------------------- big buildings (extruded footprints)
const occl = new Map();   // 25 m cells -> [top y (km), built year] of the tallest building, for street-label occlusion
{
  const n = M.big.n; let o = 0; const take = (T, len) => { const a = new T(bigBuf, o, len); o += len * T.BYTES_PER_ELEMENT; return a; };
  const cnt = take(Uint16Array, n), hd = take(Uint16Array, n), ys = take(Uint16Array, n), ye = take(Uint16Array, n), ci = take(Uint8Array, n), kd = take(Uint8Array, n);
  o = Math.ceil(o / 2) * 2; const rx = take(Uint16Array, M.big.npts), ry = take(Uint16Array, M.big.npts);
  const pal = M.big.pal; let nv = 0, ni = 0;
  for (let b = 0; b < n; b++) { nv += cnt[b] * 5; ni += cnt[b] * 6 + (cnt[b] - 2) * 3; }
  const pos = new Float32Array(nv * 3), lift = new Float32Array(nv), Yr = new Float32Array(nv * 2), col = new Uint8Array(nv * 3), idx = new Uint32Array(ni);
  let pv = 0, pi = 0, pp = 0;
  for (let b = 0; b < n; b++) {
    const m = cnt[b]; const X = [], Y = [];
    for (let j = 0; j < m; j++) { X.push(qX(rx[pp + j])); Y.push(qY(ry[pp + j])); }
    pp += m;
    let cx = 0, cy = 0; for (let j = 0; j < m; j++) { cx += X[j]; cy += Y[j]; } cx /= m; cy /= m;
    const base = wy(hAt(cx, cy)), H = ((hd[b] / 10) * M.BEX) / 1000, y0 = yr16(ys[b]), y1 = yr16(ye[b]);
    const wc = pal[ci[b]] || pal[0]; const isT = kd[b] === 2;
    const rc = isT ? wc.map((v) => Math.min(1, v * 0.7 + 0.25)) : [0.45 * 0.6 + wc[0] * 0.3, 0.47 * 0.6 + wc[1] * 0.3, 0.5 * 0.6 + wc[2] * 0.3];
    const put = (x, z, top, c) => { pos[pv * 3] = x; pos[pv * 3 + 1] = base; pos[pv * 3 + 2] = z; lift[pv] = top ? H : 0; Yr[pv * 2] = y0; Yr[pv * 2 + 1] = y1; col[pv * 3] = c[0] * 255; col[pv * 3 + 1] = c[1] * 255; col[pv * 3 + 2] = c[2] * 255; return pv++; };
    for (let j = 0; j < m; j++) {
      const k = (j + 1) % m; const ax = wx(X[j]), az = wz(Y[j]), bx = wx(X[k]), bz = wz(Y[k]);
      const a0 = put(ax, az, 0, wc), b0 = put(bx, bz, 0, wc), b1 = put(bx, bz, 1, wc), a1 = put(ax, az, 1, wc);
      idx[pi++] = a0; idx[pi++] = b0; idx[pi++] = b1; idx[pi++] = a0; idx[pi++] = b1; idx[pi++] = a1;
    }
    const contour = []; const r0 = pv;
    for (let j = 0; j < m; j++) { put(wx(X[j]), wz(Y[j]), 1, rc); contour.push(new THREE.Vector2(X[j], Y[j])); }
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) { idx[pi++] = r0 + t[0]; idx[pi++] = r0 + t[1]; idx[pi++] = r0 + t[2]; }
    // occlusion raster (tall buildings only)
    if (H > 0.03) {
      let x0 = Infinity, x1 = -Infinity, yA = Infinity, yB = -Infinity; for (let j = 0; j < m; j++) { x0 = Math.min(x0, X[j]); x1 = Math.max(x1, X[j]); yA = Math.min(yA, Y[j]); yB = Math.max(yB, Y[j]); }
      for (let gx = Math.floor(x0 / 25); gx <= Math.floor(x1 / 25); gx++) for (let gy = Math.floor(yA / 25); gy <= Math.floor(yB / 25); gy++) {
        const px = gx * 25 + 12.5, py = gy * 25 + 12.5; let inside = false;
        for (let j = 0, k = m - 1; j < m; k = j++) if ((Y[j] > py) !== (Y[k] > py) && px < ((X[k] - X[j]) * (py - Y[j])) / (Y[k] - Y[j]) + X[j]) inside = !inside;
        if (!inside) continue; const key = gx * 100000 + gy, cur = occl.get(key);
        if (!cur || cur[0] < base + H) occl.set(key, [base + H, y0, y1]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, pv * 3), 3)); g.setAttribute('aLift', new THREE.BufferAttribute(lift.subarray(0, pv), 1));
  g.setAttribute('aY', new THREE.BufferAttribute(Yr.subarray(0, pv * 2), 2)); g.setAttribute('aC', new THREE.BufferAttribute(col.subarray(0, pv * 3), 3, true));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, pi), 1)); g.computeBoundingSphere();
  const head = `attribute float aLift; attribute vec2 aY; attribute vec3 aC; uniform float uYear; varying vec3 vCol; ${RISE}`;
  const begin = `
    float r = riseOf(aY, 0.9); float gone = smoothstep(aY.y, aY.y + 0.6, uYear);
    float vis = uYear >= aY.x ? r * (1.0 - gone) : 0.0;
    vec3 transformed = position; transformed.y += aLift * vis - (vis < 0.002 ? 0.004 : 0.0);
    vCol = mix(aC, vec3(1.0, 0.82, 0.55), (1.0 - r) * 0.75);`;
  const mat = patch(new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0, flatShading: true, side: THREE.DoubleSide }), {
    vert: { head, '#include <begin_vertex>': begin },
    frag: { head: 'varying vec3 vCol;', 'vec4 diffuseColor = vec4( diffuse, opacity );': 'vec4 diffuseColor = vec4( vCol, opacity );' },
  });
  const mesh = new THREE.Mesh(g, mat); mesh.customDepthMaterial = depthTwin(mat, head, begin); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
}

// ---------------------------------------------------------------- water (rivers, reservoirs that fill in their year)
{
  const nv = M.water.nv, ni = M.water.ni; let o = 0; const take = (T, len) => { const a = new T(waterBuf, o, len); o += len * T.BYTES_PER_ELEMENT; return a; };
  const qx = take(Uint16Array, nv), qy = take(Uint16Array, nv), qh = take(Uint16Array, nv), ts = take(Uint16Array, nv), te = take(Uint16Array, nv), fd = take(Uint16Array, nv), id = take(Uint16Array, ni);
  const pos = new Float32Array(nv * 3), ay = new Float32Array(nv * 2), af = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const X = qX(qx[i]), Y = qY(qy[i]); pos[i * 3] = wx(X); pos[i * 3 + 1] = wy(TR.hmin + (qh[i] / 65535) * (TR.hmax - TR.hmin)) + 0.0004; pos[i * 3 + 2] = wz(Y);
    ay[i * 2] = yr16(ts[i]); ay[i * 2 + 1] = yr16(te[i]); af[i] = ((fd[i] / 4) * M.EX) / 1000;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aY', new THREE.BufferAttribute(ay, 2)); g.setAttribute('aF', new THREE.BufferAttribute(af, 1));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(id), 1)); g.computeVertexNormals();
  const mat = patch(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.02, 0.22, 0.55), roughness: 0.16, clearcoat: 0.7, clearcoatRoughness: 0.1, side: THREE.DoubleSide }), {
    vert: {
      head: 'attribute vec2 aY; attribute float aF; uniform float uYear; varying float vHide;',
      '#include <begin_vertex>': `vec3 transformed = position;
        float fill = aF > 0.0 ? clamp((uYear - aY.x) / (1.4 + aF * 30.0), 0.0, 1.0) : 1.0; float f2 = 1.0 - (1.0 - fill) * (1.0 - fill);
        transformed.y -= (1.0 - f2) * aF; vHide = (uYear < aY.x || uYear > aY.y) ? 1.0 : 0.0;`,
    },
    frag: { head: 'varying float vHide;', 'vec4 diffuseColor = vec4( diffuse, opacity );': 'if (vHide > 0.5) discard; vec4 diffuseColor = vec4( diffuse, opacity );' },
  });
  const water = new THREE.Mesh(g, mat); water.receiveShadow = true; water.renderOrder = 1; scene.add(water);
}

// ---------------------------------------------------------------- toy trees
const treeChunks = [];
{
  const n = M.trees.n; const qx = new Uint16Array(treesBuf, 0, n), qy = new Uint16Array(treesBuf, n * 2, n), sz = new Uint8Array(treesBuf, n * 4, n), gc = new Uint8Array(treesBuf, n * 5, n);
  const GREENS = [[0.20, 0.55, 0.20], [0.35, 0.68, 0.22], [0.12, 0.42, 0.25], [0.55, 0.72, 0.25]];
  const leaf = new THREE.IcosahedronGeometry(0.62, 1); leaf.translate(0, 1.45, 0); const trunk = new THREE.CylinderGeometry(0.1, 0.12, 1.0, 6, 1); trunk.translate(0, 0.5, 0);
  const merged = new THREE.BufferGeometry(); const lp = leaf.toNonIndexed().getAttribute('position').array, tp = trunk.toNonIndexed().getAttribute('position').array;
  const all = new Float32Array(lp.length + tp.length); all.set(lp); all.set(tp, lp.length);
  const isT = new Float32Array(all.length / 3); isT.fill(1, lp.length / 3);
  merged.setAttribute('position', new THREE.BufferAttribute(all, 3)); merged.setAttribute('aT', new THREE.BufferAttribute(isT, 1));
  const groups = new Map();
  for (let i = 0; i < n; i++) { const X = qX(qx[i]), Y = qY(qy[i]); const key = Math.floor((X - M.X0) / 4000) * 100 + Math.floor((M.Y1 - Y) / 4000); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(i); }
  const head = 'attribute vec4 iP; attribute vec3 iC; attribute float aT; varying vec3 vCol;';
  const begin = 'vec3 transformed = position * iP.w + iP.xyz; vCol = mix(iC, vec3(0.35, 0.18, 0.08), aT);';
  const mat = patch(new THREE.MeshStandardMaterial({ roughness: 0.4, flatShading: true }), {
    vert: { head, '#include <begin_vertex>': begin },
    frag: { head: 'varying vec3 vCol;', 'vec4 diffuseColor = vec4( diffuse, opacity );': 'vec4 diffuseColor = vec4( vCol, opacity );' },
  });
  const dmat = depthTwin(mat, head, begin);
  for (const ids of groups.values()) {
    const P = new Float32Array(ids.length * 4), Cc = new Float32Array(ids.length * 3); let cx = 0, cz = 0;
    ids.forEach((i, k) => { const X = qX(qx[i]), Y = qY(qy[i]); P[k * 4] = wx(X); P[k * 4 + 1] = wy(hAt(X, Y)); P[k * 4 + 2] = wz(Y); P[k * 4 + 3] = ((12 * 5) / 2.1 * (sz[i] / 100)) / 1000; const c = GREENS[gc[i]] || GREENS[0]; Cc.set(c, k * 3); cx += P[k * 4]; cz += P[k * 4 + 2]; });
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', merged.getAttribute('position')); g.setAttribute('aT', merged.getAttribute('aT'));
    g.setAttribute('iP', new THREE.InstancedBufferAttribute(P, 4)); g.setAttribute('iC', new THREE.InstancedBufferAttribute(Cc, 3)); g.instanceCount = ids.length;
    cx /= ids.length; cz /= ids.length; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 0.5, cz), 3.4);
    const mesh = new THREE.Mesh(g, mat); mesh.customDepthMaterial = dmat; mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.c = new THREE.Vector3(cx, 0, cz); scene.add(mesh); treeChunks.push(mesh);
  }
}

// ---------------------------------------------------------------- landmarks, bridges, runways
const marks = [];
{
  const srgb2lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  let o = 0;
  for (const rec of lmMeta) {
    const sizes = rec.bytes; const parts = sizes.map((s) => { const b = lmBuf.slice(o, o + s); o += s; return b; });
    const P = new Float32Array(parts[0], 0, rec.n * 3), Cs = new Uint8Array(parts[1], 0, rec.n * 3), I = new Uint32Array(parts[2], 0, rec.ni);
    const C = new Float32Array(rec.n * 3); for (let i = 0; i < rec.n * 3; i++) C[i] = srgb2lin(Cs[i]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setIndex(new THREE.BufferAttribute(I, 1));
    let pi = 3; if (rec.uv) g.setAttribute('aUv', new THREE.BufferAttribute(new Float32Array(parts[pi++], 0, rec.n * 2), 2));
    if (rec.ts) { const t = new Uint16Array(parts[pi++], 0, rec.n); const f = new Float32Array(rec.n); for (let i = 0; i < rec.n; i++) f[i] = yr16(t[i]); g.setAttribute('aTs', new THREE.BufferAttribute(f, 1)); }
    let mat;
    if (rec.name === 'TheBow') {   // dark-blue glass on a triangular steel diagrid
      mat = patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.08, flatShading: false }), {
        vert: { head: 'attribute vec2 aUv; varying vec2 vU;', '#include <begin_vertex>': '#include <begin_vertex>\n vU = aUv;' },
        frag: { head: 'varying vec2 vU; float ln(float x, float w){ float d = abs(fract(x) - 0.5); return smoothstep(0.5 - w, 0.5 - w * 0.4, d); }',
          'vec4 diffuseColor = vec4( diffuse, opacity );': `vec4 diffuseColor = vec4( vColor, opacity );
            if (vColor.r < 0.2) { float x1 = vU.x / 36.0 + vU.y / 32.0, x2 = vU.x / 36.0 - vU.y / 32.0;
              float gr = max(max(ln(x1, 0.045), ln(x2, 0.045)), ln(vU.y / 16.0, 0.05) * 0.85); diffuseColor.rgb = mix(vec3(0.030, 0.085, 0.240), vec3(0.52, 0.60, 0.70), gr); }`, '#include <color_fragment>': '' },
      });
    } else if (rec.name.startsWith('Runway')) {
      mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), {
        vert: { head: 'attribute vec2 aUv; varying vec2 vU;', '#include <begin_vertex>': '#include <begin_vertex>\n vU = aUv;' },
        frag: { head: 'varying vec2 vU;', 'vec4 diffuseColor = vec4( diffuse, opacity );': `vec4 diffuseColor = vec4( vColor, opacity );
          float dash = step(0.2, sin(vU.x * 180.0)) * step(abs(vU.y - 0.5), 0.03); float ends = step(min(vU.x, 1.0 - vU.x), 0.025) * step(0.0, sin(vU.y * 60.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), max(dash, ends));`, '#include <color_fragment>': '' },
      });
    } else if (rec.ts) {   // bridges slide up out of the river in their year
      mat = patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.3, flatShading: true, side: THREE.DoubleSide }), {
        vert: { head: 'attribute float aTs; uniform float uYear; varying float vHide;', '#include <begin_vertex>': `vec3 transformed = position;
          float r = clamp((uYear - aTs) / 0.8, 0.0, 1.0); r = 1.0 - pow(1.0 - r, 3.0); transformed.y -= (1.0 - r) * 0.1; vHide = uYear < aTs ? 1.0 : 0.0;` },
        frag: { head: 'varying float vHide;', 'vec4 diffuseColor = vec4( diffuse, opacity );': 'if (vHide > 0.5) discard; vec4 diffuseColor = vec4( diffuse, opacity );' },
      });
    } else {
      mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.22, flatShading: true, side: THREE.DoubleSide });
    }
    if (rec.name === 'TheBow') g.computeVertexNormals();
    const b = new THREE.Vector3(...rec.base); g.translate(-b.x, -b.y, -b.z);
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true;
    const grp = new THREE.Group(); grp.position.copy(b); grp.add(mesh); scene.add(grp);
    if (rec.y0) marks.push({ grp, y0: rec.y0, y1: rec.y1, runway: rec.name.startsWith('Runway') });
  }
}

// ---------------------------------------------------------------- rail and C-Train tracks (ribbons with ties and rails)
{
  let o = 0; const pos = [], uv = [], ys = [], idx = [];
  for (const rr of trMeta) {
    const n = rr.n; const p = new Float32Array(trBuf, o, n * 3); o += n * 12; const y = new Uint16Array(trBuf, o, n); o += n * 2 + ((n % 2) ? 2 : 0);
    for (let k = 0; k < rr.offs.length - 1; k++) {
      const a = rr.offs[k], b = rr.offs[k + 1]; if (b - a < 2) continue; let s = 0;
      for (let i = a; i < b; i++) {
        const j0 = Math.max(a, i - 1), j1 = Math.min(b - 1, i + 1); let tx = p[j1 * 3] - p[j0 * 3], tz = p[j1 * 3 + 2] - p[j0 * 3 + 2]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
        if (i > a) s += Math.hypot(p[i * 3] - p[(i - 1) * 3], p[i * 3 + 2] - p[(i - 1) * 3 + 2]);
        const nx = -tz * rr.width / 2, nz = tx * rr.width / 2, base = pos.length / 3;
        pos.push(p[i * 3] + nx, p[i * 3 + 1], p[i * 3 + 2] + nz, p[i * 3] - nx, p[i * 3 + 1], p[i * 3 + 2] - nz);
        uv.push(s * 1000 / 7, 0, s * 1000 / 7, 1); const yy = yr16(y[i]); ys.push(yy, yy);
        if (i > a) idx.push(base - 2, base, base - 1, base - 1, base, base + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aTs', new THREE.Float32BufferAttribute(ys, 1));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = patch(new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), {
    vert: { head: 'attribute vec2 aUv; attribute float aTs; uniform float uYear; varying vec2 vU; varying float vHide;', '#include <begin_vertex>': '#include <begin_vertex>\n vU = aUv; vHide = uYear < aTs ? 1.0 : 0.0;' },
    frag: { head: 'varying vec2 vU; varying float vHide;', 'vec4 diffuseColor = vec4( diffuse, opacity );': `if (vHide > 0.5) discard;
      vec3 c = vec3(0.34, 0.30, 0.27); c = mix(c, vec3(0.36, 0.22, 0.12), step(0.55, fract(vU.x)) * step(0.12, vU.y) * step(vU.y, 0.88));
      float rail = max(step(abs(vU.y - 0.33), 0.04), step(abs(vU.y - 0.67), 0.04)); c = mix(c, vec3(0.62, 0.62, 0.64), rail);
      vec4 diffuseColor = vec4(c, opacity);` },
  });
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m);
}

// ---------------------------------------------------------------- story: stops, chapters, census
const stops = M.stops.filter((s) => s.key);
const UNTIL = { fort_calgary: 1914, hbc_store: 1913, cpr_station: 1966 };
const builtYear = (s) => { const m = s.title.match(/(\d{4})/); return m ? +m[1] : 1900; };
function population(y) {
  // census counts to 2021, then City of Calgary April 1 estimates (2022-2025) and forecast (2026)
  const C = M.census, est = y > (M.census_last || 2021);
  if (y >= C[C.length - 1][0]) return [C[C.length - 1][1], est];
  if (y <= C[0][0]) return [C[0][1], false];
  for (let i = 0; i < C.length - 1; i++) if (y < C[i + 1][0]) { const f = (y - C[i][0]) / (C[i + 1][0] - C[i][0]); return [Math.round(Math.exp(Math.log(C[i][1]) * (1 - f) + Math.log(C[i + 1][1]) * f)), est]; }
}
const chapterOf = (y) => { let c = M.chapters[0][1]; for (const [yy, t] of M.chapters) if (y >= yy) c = t; return c; };

// tour list + pins
const stopsEl = $('stops'); const pinsEl = $('labels');
// Calgary Vision Centre: at the centre of the city since 1998 (Suite 210, Gulf Canada Square +15, 401 9th Ave SW)
const CVC = M.cvc || null;
const CVC_SUB = 'Right at the centre of Calgary since 1998: Suite 210 on the +15 level of Gulf Canada Square, 401 9th Ave SW. The city has grown up around us for more than 25 years.';
const pins = stops.map((s, i) => {
  const isC = s.key === 'cvc';
  const b = document.createElement('button'); b.className = 'chip' + (isC ? ' cvc' : ''); b.innerHTML = `<span class="y">${isC ? 1998 : Math.floor(s.year)}</span><span class="t">${s.title.replace(/ · \d{4}.*$/, '')}</span>`;
  b.addEventListener('click', () => goStop(i)); stopsEl.appendChild(b);
  const p = document.createElement('div'); p.className = 'pin' + (isC ? ' cvc' : '');
  p.innerHTML = isC ? '<i></i>' : `<i></i><b>${s.title.replace(/ · .*$/, '')}</b>`; p.style.display = 'none';   // the clinic: just its logo
  p.addEventListener('click', () => (isC ? goStop(i, 2.0, year < 1998) : goStop(i))); pinsEl.appendChild(p);
  const ay = isC && CVC ? CVC.ground + CVC.top + 0.012 : s.ground + (s.ah * 1.0) / 1000;
  const pos = isC && CVC ? new THREE.Vector3(CVC.anchor[0], ay, CVC.anchor[1]) : new THREE.Vector3(s.anchor[0], ay, s.anchor[1]);
  return { el: p, chip: b, pos, y0: isC ? 0 : builtYear(s), y1: UNTIL[s.key] || 1e4, w: isC ? 0 : s.title.replace(/ · .*$/, '').length * 7.4, sel: false, cvc: isC };
});
const cvcI = pins.findIndex((p) => p.cvc);
// the clinic's block (9th Avenue & 4th Street SW) through time: the pin and its card say what stood here in each era
// [from year, pin title, pin subtitle, card title, card text]
const CVC_ERAS = [
  [0, 'Future home of Calgary Vision Centre', 'Beside the CPR main line', 'Future home of Calgary Vision Centre',
    'In the early 1900s this corner of 9th Avenue and 4th Street SW sat beside the CPR main line at the west end of the young town. Calgary Vision Centre opens here, on the +15 level of Gulf Canada Square, in 1998.'],
  [1910, 'Robin Hood flour mill', 'Future home of Calgary Vision Centre', 'Robin Hood flour mill · c. 1910–1969',
    'From about 1910 the Robin Hood Flour Mills plant stood here beside the CPR main line. By the 1940s it could mill 2,000 barrels of flour a day and store a million bushels of grain. Calgary Vision Centre opens on this spot in 1998.'],
  [1969, 'Robin Hood mill · closed 1969', 'Future home of Calgary Vision Centre', 'Robin Hood flour mill · closed 1969',
    'The mill shut down in 1969, and in 1971 the property was given to the City of Calgary. It was demolished in 1973. Calgary Vision Centre opens on this spot in 1998.'],
  [1973, 'Mill site cleared · 1973', 'Future home of Calgary Vision Centre', 'Robin Hood mill demolished · 1973',
    'The old mill came down in 1973 to make way for Gulf Canada Square, which opened here in 1979. Calgary Vision Centre opens on its +15 level in 1998.'],
  [1979, 'Gulf Canada Square · 1979', 'Future home of Calgary Vision Centre', 'Gulf Canada Square · 1979',
    'Gulf Canada Square opened on the old mill site in 1979, linked to downtown\'s +15 walkway network. Calgary Vision Centre opens here, on the +15 level, in 1998.'],
  [1998, 'Calgary Vision Centre', 'At the centre of the city since 1998', 'Calgary Vision Centre · since 1998', CVC_SUB],
];
const cvcEraAt = (y) => { let k = 0; for (let i = 0; i < CVC_ERAS.length; i++) if (y >= CVC_ERAS[i][0]) k = i; return k; };
{ const st = document.createElement('style');   // before 1998 the clinic pin is a hollow, dashed 'future home' marker
  st.textContent = '#card .t { padding-right: 24px; }';
  document.head.appendChild(st); }
let cvcEraI = -1;
function cvcCard(k) { const e = CVC_ERAS[k]; $('cardT').textContent = e[3]; $('cardS').textContent = e[4]; }
// the clinic pin sits on whatever stands on the block that year: just above the lots and the low mill buildings,
// then rides up with Gulf Canada Square as it rises (from 1978.7) to settle on its roof
function cvcPinY(y) {
  const lo = y >= 1910 && y < 1977.5 ? 0.035 : 0.012, r = Math.min(1, Math.max(0, (y - 1978.7) / 0.9)), e = 1 - Math.pow(1 - r, 3);
  return CVC.ground + lo + (CVC.top + 0.012 - lo) * e;
}
function updCvcEra(y) {
  if (cvcI >= 0 && CVC) pins[cvcI].pos.y = cvcPinY(y);
  if (cvcI < 0) return; const k = cvcEraAt(y); if (k === cvcEraI) return; cvcEraI = k;
  const e = CVC_ERAS[k], p = pins[cvcI]; p.el.title = e[1] === e[2] ? e[1] : `${e[1]} \u00b7 ${e[2]}`; p.el.setAttribute('aria-label', p.el.title);   // the era's text lives in the tooltip and the card
  p.el.classList.toggle('past', k < CVC_ERAS.length - 1);
  if (pins[cvcI].sel && $('card').style.display === 'block' && !(typeof flight !== 'undefined' && flight && flight.y1 != null)) cvcCard(k);
}

// ---------------------------------------------------------------- street labels (major roads by zoom, hidden behind towers)
const SN = streets.names, SP = streets.prio, SA = streets.a;
const slPool = new Map(); let slOn = true;
function occluded(p) {   // march from the street point toward the camera over the tall-building raster (first 2.5 km)
  const c = camera.position; const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z; const L = Math.hypot(dx, dz) || 1e-6; const yr = U.uYear.value;
  for (let s = 0.03; s < Math.min(L, 2.5); s += 0.02) {
    const f = s / L; const X = (p.x + dx * f) * 1000 + M.XC, Y = -(p.z + dz * f) * 1000 + M.YC; const cell = occl.get(Math.floor(X / 25) * 100000 + Math.floor(Y / 25));
    if (!cell || yr < cell[1] || yr > cell[2]) continue;
    if (cell[0] > p.y + dy * f) return true;
  }
  return false;
}
const v3 = new THREE.Vector3(), v3b = new THREE.Vector3();
function updateLabels(W, H) {
  const dist = camera.position.distanceTo(controls.target); const yr = U.uYear.value;
  const minP = dist < 1.3 ? 1 : dist < 2.6 ? 2 : dist < 5.5 ? 3 : dist < 13 ? 4 : 5; const maxN = coarse ? 9 : 16;
  const cands = [];
  if (slOn) for (let i = 0; i < SA.length; i++) {
    const a = SA[i], pr = SP[a[0]]; if (pr < minP || a[5] > yr) continue;
    v3.set(a[1], a[3], a[2]); const d = v3.distanceTo(controls.target); if (d > dist * 2.2) continue;
    v3b.copy(v3).project(camera); if (v3b.z > 1 || Math.abs(v3b.x) > 0.92 || Math.abs(v3b.y) > 0.86) continue;
    cands.push([pr * 10 - d / dist * 6, i, (v3b.x * 0.5 + 0.5) * W, (-v3b.y * 0.5 + 0.5) * H]);
  }
  cands.sort((p, q) => q[0] - p[0]);
  const boxes = [], names = new Set(), keep = new Set();
  // landmark pins: nearest the centre win, overlapping ones hide
  const pv = [];
  for (const p of pins) {
    p.el.style.display = 'none';
    if (!(yr >= p.y0 - 0.01 && yr < p.y1 && (dist < 9 || p.cvc))) continue;
    v3b.copy(p.pos).project(camera); if (v3b.z > 1 || Math.abs(v3b.x) > 1.0 || Math.abs(v3b.y) > 1.0) continue;
    const x = (v3b.x * 0.5 + 0.5) * W, y = (-v3b.y * 0.5 + 0.5) * H; pv.push([Math.hypot(x - W / 2, y - H / 2) - (p.sel ? 1e6 : 0) - (p.cvc ? 2e6 : 0), p, x, y]);
  }
  pv.sort((a, b) => a[0] - b[0]);
  for (const [, p, x, y] of pv) {
    const bx = p.cvc ? [x - 19, y - 19, x + 19, y + 19] : [x - 9, y - 11, x + 16 + p.w, y + 11]; if (!p.cvc && (bx[2] > W - 8 || bx[0] < 8)) continue;
    if (boxes.some((b) => !(bx[2] < b[0] || b[2] < bx[0] || bx[3] < b[1] || b[3] < bx[1]))) continue;
    boxes.push(bx); p.el.style.display = 'flex';
    if (p.cvc) { const r = p.el.offsetWidth / 2; p.el.style.transform = `translate(${x - r}px, ${y - r}px)`; }   // logo badge centred on the clinic
    else p.el.style.transform = `translate(${x - 7}px, ${y - 7}px)`;
  }
  for (const [, i, x, y] of cands) {
    if (keep.size >= maxN) break; const a = SA[i], nm = SN[a[0]]; if (names.has(nm)) continue;
    const w = nm.length * 7.2 + 12; v3.set(a[1], a[3], a[2]);
    v3b.set(a[1] + Math.cos(a[4]) * 0.05, a[3], a[2] + Math.sin(a[4]) * 0.05).project(camera);
    const x2 = (v3b.x * 0.5 + 0.5) * W, y2 = (-v3b.y * 0.5 + 0.5) * H; let ang = Math.atan2(y2 - y, x2 - x); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
    const hw = (Math.abs(Math.cos(ang)) * w + Math.abs(Math.sin(ang)) * 16) / 2, hh = (Math.abs(Math.sin(ang)) * w + Math.abs(Math.cos(ang)) * 16) / 2;
    const bx = [x - hw, y - hh, x + hw, y + hh];
    if (boxes.some((b) => !(bx[2] < b[0] || b[2] < bx[0] || bx[3] < b[1] || b[3] < bx[1]))) continue;
    if (occluded(v3)) continue;
    boxes.push(bx); names.add(nm); keep.add(i);
    let el = slPool.get(i);
    if (!el) { el = document.createElement('div'); el.className = 'sl p' + SP[a[0]]; el.textContent = nm; el.style.opacity = '0'; el.style.transition = 'opacity 0.35s'; pinsEl.appendChild(el); slPool.set(i, el); requestAnimationFrame(() => (el.style.opacity = '1')); }
    else el.style.opacity = '1';
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${ang}rad)`;
  }
  for (const [i, el] of slPool) if (!keep.has(i)) { slPool.delete(i); el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }
}

// ---------------------------------------------------------------- UI: year, playback, tour
const slider = $('year'); const ticks = $('ticks'); const Y0 = 1900.99;
for (const [y, lab, cls] of [[1900, '1900', 'end'], [1916, '1916', 'stop'], [1932, '1932', 'stop'], [1968, '1968', 'stop'], [1988, '1988', 'stop'], [2012, '2012', 'stop'], [2026, '2026', 'end']]) {
  const s = document.createElement('span'); s.className = cls; s.textContent = lab; s.style.left = ((Math.max(y, Y0) - Y0) / (2026 - Y0)) * 100 + '%'; ticks.appendChild(s);
}
let year = Y0, playing = false, speed = 4, lastChange = -1e9, glowStart = 1900;
function setYear(y, fromUser = false) {
  const prev = year; year = Math.min(2026, Math.max(Y0, y));
  if (year > prev + 1e-6 && performance.now() - lastChange > 900) glowStart = prev;
  if (Math.abs(year - prev) > 1e-6) lastChange = performance.now();
  updCvcEra(year); U.uYear.value = year; slider.value = year; slider.style.setProperty('--p', ((year - Y0) / (2026 - Y0)) * 100 + '%');
  $('yearTxt').textContent = Math.floor(year + 1e-6); $('eraTxt').textContent = chapterOf(year);
  const [pop, last] = population(year); $('popTxt').textContent = `Population ${pop.toLocaleString('en-CA')}${last ? ' (City estimate)' : ''}`;
  for (const m of marks) {
    const r = Math.min(1, Math.max(0, (year - m.y0) / 1.2)); const rr = 1 - Math.pow(1 - r, 3); const gone = m.y1 && year >= m.y1;
    m.grp.visible = year >= m.y0 && !gone; if (!m.runway) m.grp.scale.y = Math.max(rr, 0.001);
  }
  dirty = true;
}
slider.addEventListener('input', () => { setPlaying(false); setYear(+slider.value, true); });
function setPlaying(p) {
  playing = p; $('play').setAttribute('aria-label', p ? 'Pause time-lapse' : 'Play time-lapse');
  $('playIco').innerHTML = p ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
  if (p && year >= 2025.9) setYear(Y0);
}
$('play').addEventListener('click', () => setPlaying(!playing));
const SPEEDS = [[4, '1×'], [8, '2×'], [2, '½×']]; let si = 0;
$('speed').addEventListener('click', () => { si = (si + 1) % SPEEDS.length; speed = SPEEDS[si][0]; $('speed').textContent = SPEEDS[si][1]; });
$('lbl').addEventListener('click', () => { slOn = !slOn; $('lbl').setAttribute('aria-pressed', slOn); dirty = true; });
$('tourBtn').addEventListener('click', () => { const o = $('tour').classList.toggle('open'); $('tourBtn').setAttribute('aria-pressed', o); });
if (innerWidth >= 1200) { $('tour').classList.add('open'); $('tourBtn').setAttribute('aria-pressed', 'true'); }
$('aboutBtn').addEventListener('click', () => { const d = $('about'); d.style.display = d.style.display === 'block' ? 'none' : 'block'; });
$('aboutX').addEventListener('click', () => ($('about').style.display = 'none'));
$('cardX').addEventListener('click', () => { $('card').style.display = 'none'; for (const p of pins) p.chip.removeAttribute('aria-current'); });

// camera flights
let flight = null;
function camState() { const t = controls.target, off = camera.position.clone().sub(t); const d = off.length(); return { tx: t.x, ty: t.y, tz: t.z, d, el: Math.asin(off.y / d), az: Math.atan2(off.x, -off.z) }; }
function applyCam(s) {
  controls.target.set(s.tx, s.ty, s.tz);
  camera.position.set(s.tx + Math.sin(s.az) * Math.cos(s.el) * s.d, s.ty + Math.sin(s.el) * s.d, s.tz - Math.cos(s.az) * Math.cos(s.el) * s.d);
  camera.lookAt(controls.target);
}
function flyTo(to, dur = 1.8, yearTo = null) {
  const from = camState(); let daz = to.az - from.az; daz = ((daz + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  flight = { from, to: { ...to, az: from.az + daz }, t0: performance.now(), dur: dur * 1000, y0: year, y1: yearTo };
}
let dirA = null;   // 'Get directions' link, shown on the Calgary Vision Centre card only
function dirLink(show) {
  if (!dirA) {
    dirA = document.createElement('a'); dirA.target = '_blank'; dirA.rel = 'noopener'; dirA.textContent = 'Get directions \u2197';
    dirA.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Calgary Vision Centre, 401 9 Ave SW, Calgary, AB');
    dirA.style.cssText = 'display:inline-block;margin-top:7px;font-weight:700;font-size:12.5px;color:var(--cvc-ink);text-decoration:none;border-bottom:1.5px solid currentColor';
    $('card').appendChild(dirA);
  }
  dirA.style.display = show ? 'inline-block' : 'none';
}
let todayA = null;   // 'See it today' link on the clinic card when it was opened in an earlier year
function todayLink(show) {
  if (!todayA) {
    todayA = document.createElement('button'); todayA.type = 'button'; todayA.textContent = 'See it today \u2192';
    todayA.style.cssText = 'display:inline-block;margin:7px 0 0 14px;padding:0;background:none;border:0;border-bottom:1.5px solid currentColor;font:inherit;font-weight:700;font-size:12.5px;color:var(--cvc-ink);cursor:pointer';
    todayA.addEventListener('click', () => goStop(cvcI)); $('card').appendChild(todayA);
  }
  todayA.style.display = show ? 'inline-block' : 'none';
}
function goStop(i, dur = 2.0, keepYear = false) {
  const s = stops[i], c = s.cam; setPlaying(false);
  // on narrow screens the info card covers the lower half: aim a little in front of the stop so it sits higher in the view
  // (and step back a little, since a tall narrow view shows less of the city around it)
  const az = THREE.MathUtils.degToRad(c.az), nar = innerWidth < 700, d = c.d * 1.15 * (nar ? 1.45 : 1), sh = nar ? d * 0.3 : 0;
  flyTo({ tx: c.tx + Math.sin(az) * sh, ty: c.ty, tz: c.tz - Math.cos(az) * sh, d, el: THREE.MathUtils.degToRad(c.el), az }, dur, keepYear ? null : s.year);
  $('cardT').textContent = s.key === 'cvc' ? 'Calgary Vision Centre · since 1998' : s.title; $('cardS').textContent = s.key === 'cvc' ? CVC_SUB : s.sub; $('card').style.display = 'block';
  $('card').classList.toggle('cvc', s.key === 'cvc'); dirLink(s.key === 'cvc'); todayLink(s.key === 'cvc' && keepYear);
  if (s.key === 'cvc') cvcCard(keepYear ? cvcEraAt(year) : CVC_ERAS.length - 1);
  for (const p of pins) { p.chip.removeAttribute('aria-current'); p.sel = false; } pins[i].chip.setAttribute('aria-current', 'true'); pins[i].sel = true;
  if (innerWidth < 1200) { $('tour').classList.remove('open'); $('tourBtn').setAttribute('aria-pressed', 'false'); }
}
const HOME = { tx: 0.85, ty: 0.3, tz: -3.4, d: 46, el: THREE.MathUtils.degToRad(48), az: THREE.MathUtils.degToRad(200) };
$('home').addEventListener('click', () => flyTo(HOME, 1.6));
if (cvcI >= 0) $('cvcLink').addEventListener('click', () => goStop(cvcI)); else $('cvcLink').style.display = 'none';
$('north').addEventListener('click', () => { const s = camState(); flyTo({ ...s, az: Math.PI }, 0.9); });
const zoomBy = (f) => { const s = camState(); flyTo({ ...s, d: Math.min(controls.maxDistance, Math.max(controls.minDistance, s.d * f)) }, 0.45); };
$('zin').addEventListener('click', () => zoomBy(0.6)); $('zout').addEventListener('click', () => zoomBy(1.6));
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === '+' || e.key === '=') zoomBy(0.7); else if (e.key === '-') zoomBy(1.4);
});
['pointerdown', 'wheel'].forEach((ev) => canvas.addEventListener(ev, () => { flight = null; $('hint').style.opacity = '0'; }, { passive: true }));
// 'Getting around' card: mouse buttons (or touch gestures on phones and tablets) for moving, turning and zooming
const TOUCH = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches; document.body.classList.toggle('touch', TOUCH);
function showHelp(on) { $('help').style.display = on ? 'block' : 'none'; $('helpBtn').setAttribute('aria-pressed', on ? 'true' : 'false'); if (on) $('about').style.display = 'none'; }
$('helpBtn').addEventListener('click', () => showHelp($('help').style.display !== 'block'));
$('helpX').addEventListener('click', () => showHelp(false));
canvas.addEventListener('pointerdown', () => showHelp(false), { passive: true });
addEventListener('keydown', (e) => { if (e.key === 'Escape') showHelp(false); else if (e.key === '?' && e.target.tagName !== 'INPUT') showHelp($('help').style.display !== 'block'); });

// ---------------------------------------------------------------- theme-aware background
function applyTheme() { const c = getComputedStyle(document.documentElement).getPropertyValue('--scene').trim() || '#15191e'; scene.background = new THREE.Color(c); dirty = true; }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------------------------------------------------------------- frame loop

// ---------------------------------------------------------------- the film's miniature look (WebGL2): soft contact shadows (GTAO), depth of field
// focused on the view centre like a macro lens on a model, and the film's AgX colour grade. ?simple in the URL turns it off.
class MiniaturePass extends Pass {
  constructor(taps) {
    super();
    const ht = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtA = ht(); this.rtB = ht(); this.depthTexture = null; this.fsq = new FullScreenQuad(null);
    this.u = { tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 100 }, uFocus: { value: 1 }, uK: { value: 8 }, uMax: { value: 12 }, uRes: { value: new THREE.Vector2(1, 1) } };
    const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const DEPTH = `#include <packing>
      uniform sampler2D tDepth; uniform float uNear, uFar, uFocus, uK, uMax; uniform vec2 uRes; varying vec2 vUv;
      float zAt(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
      float cocAt(float z){ return clamp(uK * (1.0 - uFocus / z), -uMax, uMax); }`;   // signed blur radius, device px; < 0 in front of the focus
    const mk = (fs, extra = {}, defines = {}) => new THREE.ShaderMaterial({ uniforms: { ...this.u, ...extra }, vertexShader: VS, fragmentShader: fs, defines, depthTest: false, depthWrite: false, toneMapped: false });
    // 1. half resolution colour + blur radius (the nearest of the 2x2 depths, so foreground edges keep their blur)
    this.prep = mk(`${DEPTH} uniform sampler2D tColor;
      void main(){ vec2 h = 0.5 / uRes; float z = min(min(zAt(vUv + vec2(-h.x, -h.y)), zAt(vUv + vec2(h.x, -h.y))), min(zAt(vUv + vec2(-h.x, h.y)), zAt(vUv + vec2(h.x, h.y))));
        gl_FragColor = vec4(texture2D(tColor, vUv).rgb, cocAt(z)); }`, { tColor: { value: null } });
    // 2. gather blur at half resolution: nearer samples spill over with their own radius, farther ones only within this pixel's radius
    this.blur = mk(`${DEPTH} uniform sampler2D tSrc; uniform vec2 uHalf;
      void main(){ vec4 c0 = texture2D(tSrc, vUv); float r0 = abs(c0.a) * 0.5; float rmax = uMax * 0.5;
        vec3 acc = c0.rgb; float ws = 1.0;
        for (int i = 0; i < TAPS; i++) {
          float fi = float(i) + 0.5; float r = sqrt(fi / float(TAPS)) * rmax; float a = fi * 2.39996323;
          vec4 s = texture2D(tSrc, vUv + vec2(cos(a), sin(a)) * r / uHalf);
          float reach = s.a < c0.a ? abs(s.a) * 0.5 : min(abs(s.a) * 0.5, r0);
          float w = clamp(reach - r + 1.0, 0.0, 1.0); acc += s.rgb * w; ws += w;
        }
        gl_FragColor = vec4(acc / ws, c0.a); }`, { tSrc: { value: null }, uHalf: { value: new THREE.Vector2(1, 1) } }, { TAPS: taps });
    // 3. composite sharp/blurred by blur radius, then grade: AgX with Blender's "High Contrast" look, a little saturation, soft vignette
    this.comp = mk(`${DEPTH} uniform sampler2D tColor, tBlur; uniform vec3 uBg; uniform float uExpo, uCon, uSat, uVig, uAspect;
      const mat3 TO2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
      const mat3 FROM2020 = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
      const mat3 INSET = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
      const mat3 OUTSET = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
      float lu(vec3 c){ float l = dot(c, vec3(0.299, 0.587, 0.114)); return sqrt(l / (1.0 + l)); }
      vec3 fxaa(vec2 uv){   // classic FXAA on the HDR colour (luma compressed first)
        vec2 px = 1.0 / uRes;
        vec3 cNW = texture2D(tColor, uv + vec2(-1.0, -1.0) * px).rgb, cNE = texture2D(tColor, uv + vec2(1.0, -1.0) * px).rgb;
        vec3 cSW = texture2D(tColor, uv + vec2(-1.0, 1.0) * px).rgb, cSE = texture2D(tColor, uv + vec2(1.0, 1.0) * px).rgb, cM = texture2D(tColor, uv).rgb;
        float lNW = lu(cNW), lNE = lu(cNE), lSW = lu(cSW), lSE = lu(cSE), lM = lu(cM);
        float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
        vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
        float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0); float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
        dir = clamp(dir * rcp, -8.0, 8.0) * px;
        vec3 a = 0.5 * (texture2D(tColor, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tColor, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
        vec3 b = a * 0.5 + 0.25 * (texture2D(tColor, uv - dir * 0.5).rgb + texture2D(tColor, uv + dir * 0.5).rgb);
        float lb = lu(b); return (lb < lMin || lb > lMax) ? a : b; }
      vec3 agxCurve(vec3 x){ vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
      vec3 agx(vec3 c){
        c = INSET * (TO2020 * c); c = (log2(max(c, 1e-10)) + 12.47393) / 16.5;
        c = clamp((c - 0.606) * uCon + 0.606, 0.0, 1.0);
        c = OUTSET * agxCurve(c); c = pow(max(c, 0.0), vec3(2.2)); return FROM2020 * c; }
      void main(){
        float d = texture2D(tDepth, vUv).x;
        vec3 sharp = fxaa(vUv); vec4 bl = texture2D(tBlur, vUv);
        float c = abs(cocAt(-perspectiveDepthToViewZ(d, uNear, uFar)));
        float m = smoothstep(0.7, 2.6, max(c, bl.a < 0.0 ? abs(bl.a) : 0.0));
        vec3 col = mix(sharp, bl.rgb, m) * uExpo;
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = max(mix(vec3(l), col, uSat), 0.0);
        col = agx(col);
        vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0); col *= mix(1.0, smoothstep(1.15, 0.25, length(q)), uVig);
        if (d > 0.99999) col = uBg;
        gl_FragColor = vec4(col + (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0, 1.0);
        #include <colorspace_fragment>
      }`, { tColor: { value: null }, tBlur: { value: null }, uBg: { value: new THREE.Color() }, uExpo: { value: 0.48 }, uCon: { value: 1.5 }, uSat: { value: 1.35 }, uVig: { value: 0.35 }, uAspect: { value: 1 } });
  }
  setSize(w, h) { this.rtA.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); this.rtB.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); this.u.uRes.value.set(w, h); this.blur.uniforms.uHalf.value.set(Math.max(1, w >> 1), Math.max(1, h >> 1)); this.comp.uniforms.uAspect.value = w / h; }
  render(renderer, writeBuffer, readBuffer) {
    this.u.tDepth.value = this.depthTexture;
    this.prep.uniforms.tColor.value = readBuffer.texture; this.fsq.material = this.prep; renderer.setRenderTarget(this.rtA); this.fsq.render(renderer);
    this.blur.uniforms.tSrc.value = this.rtA.texture; this.fsq.material = this.blur; renderer.setRenderTarget(this.rtB); this.fsq.render(renderer);
    this.comp.uniforms.tColor.value = readBuffer.texture; this.comp.uniforms.tBlur.value = this.rtB.texture; this.fsq.material = this.comp;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.fsq.render(renderer);
  }
}
const LOOK = { ao: POST && !lowPower, taps: lowPower ? 16 : 32, dof: 0.42, aoStrength: 1.0, aoR: 0.05 };
let composer = null, gtao = null, mini = null;
if (POST) {
  const qp = new URLSearchParams(location.search); const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: +(qp.get('msaa') ?? 0) }); rt.depthTexture = new THREE.DepthTexture(1, 1);
  composer = new EffectComposer(renderer, rt); composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  if (LOOK.ao) {
    gtao = new GTAOPass(scene, camera, 1, 1); gtao.blendIntensity = LOOK.aoStrength;
    const gs = gtao.setSize.bind(gtao); gtao.setSize = (w, h) => gs(Math.max(1, w >> 1), Math.max(1, h >> 1));   // AO at half resolution
    gtao.updateGtaoMaterial({ samples: 12, distanceExponent: 1.4, scale: 1.4 }); gtao.updatePdMaterial({ samples: 12, radius: 6 });
    composer.addPass(gtao);
  }
  mini = new MiniaturePass(LOOK.taps); composer.addPass(mini);
}
// image-based reflections for the toy plastic (a soft studio), with the direct lights turned down to match
{
  if (POST) { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture; pm.dispose();
  scene.traverse((o) => { const m = o.material; if (m && m.isMeshStandardMaterial) m.envMapIntensity = o.name === 'terrain' ? 0.1 : 0.3; }); }
}
let perfN = 0, perfT = 0, perfStage = 0, lastDraw = 0;
function perfWatch() {   // slow GPU: drop the contact shadows first, then render at 1x pixel density
  const now = performance.now(); if (lastDraw && now - lastDraw < 200) { perfT += now - lastDraw; perfN++; } lastDraw = now;
  if (perfN < 45) return; const avg = perfT / perfN; perfN = perfT = 0; if (avg < 40) return;
  if (perfStage === 0 && gtao) { gtao.enabled = false; perfStage = 1; }
  else if (perfStage <= 1 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); composer.setPixelRatio(1); resize(); perfStage = 2; }
}
function renderScene(dist) {
  if (!composer) { renderer.render(scene, camera); return; }
  perfWatch();
  const rt = composer.readBuffer; mini.depthTexture = rt.depthTexture;
  if (gtao) { gtao.setGBuffer(rt.depthTexture); const r = Math.min(0.5, Math.max(0.004, dist * LOOK.aoR)); gtao.updateGtaoMaterial({ radius: r, thickness: r }); }
  const H = renderer.domElement.height, u = mini.u;
  u.uNear.value = camera.near; u.uFar.value = camera.far; u.uFocus.value = dist; u.uK.value = 0.016 * H * LOOK.dof; u.uMax.value = Math.max(2, 0.03 * H * LOOK.dof);
  mini.comp.uniforms.uBg.value.copy(scene.background);
  composer.render();
}
let dirty = true; controls.addEventListener('change', () => (dirty = true));
function resize() { const W = innerWidth, H = innerHeight; renderer.setSize(W, H, false); if (composer) composer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); dirty = true; }
addEventListener('resize', resize);
const START = stops[0].cam;
// open on the whole model, then glide down into the 1900 town (like the film's table-top opening)
const START_VIEW = { tx: 1.25, ty: START.ty, tz: -4.45, d: 2.6, el: THREE.MathUtils.degToRad(36), az: THREE.MathUtils.degToRad(205) };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
applyCam(reduceMotion ? START_VIEW : { ...HOME, d: 62, el: THREE.MathUtils.degToRad(40), az: THREE.MathUtils.degToRad(212) });
// address options for embedding: ?find (or ?clinic) opens in 2026 and flies down to Calgary Vision Centre with its card open;
// ?year=1950 starts in that year
const QP = new URLSearchParams(location.search); const FIND = (QP.has('find') || QP.has('clinic')) && cvcI >= 0; const QY = parseFloat(QP.get('year'));
controls.update(); applyTheme(); resize(); setYear(FIND ? 2026 : QY >= 1900 && QY <= 2026 ? QY : Y0);
if (FIND) setTimeout(() => { if (!flight) goStop(cvcI, reduceMotion ? 0.01 : 4.2); }, reduceMotion ? 0 : 900);
else if (!reduceMotion) setTimeout(() => { if (!flight) flyTo(START_VIEW, 3.4); }, 1300);
let last = performance.now(), labelTick = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (playing) { setYear(year + speed * dt); if (year >= 2026) setPlaying(false); }
  if (flight) {
    const f = Math.min(1, (now - flight.t0) / flight.dur), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2; const a = flight.from, b = flight.to;
    const lerp = (p, q) => p + (q - p) * e; const dl = Math.exp(lerp(Math.log(a.d), Math.log(b.d))) * (1 + 0.35 * Math.sin(Math.PI * e) * Math.min(1, Math.hypot(b.tx - a.tx, b.tz - a.tz) / Math.max(a.d, b.d)));
    applyCam({ tx: lerp(a.tx, b.tx), ty: lerp(a.ty, b.ty), tz: lerp(a.tz, b.tz), d: dl, el: lerp(a.el, b.el), az: lerp(a.az, b.az) });
    if (flight.y1 != null) setYear(flight.y0 + (flight.y1 - flight.y0) * e);
    if (f >= 1) flight = null; dirty = true;
  }
  const moved = controls.update();
  // keep the target on the model
  const t = controls.target; const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const tx = cl(t.x, -M.TW / 2000, M.TW / 2000), tz = cl(t.z, -M.TH / 2000, M.TH / 2000);
  if (tx !== t.x || tz !== t.z) { camera.position.x += tx - t.x; camera.position.z += tz - t.z; t.x = tx; t.z = tz; }
  const glowOn = performance.now() - lastChange < 800 ? 1 : Math.max(0, 1 - (performance.now() - lastChange - 800) / 900);
  if (Math.abs(U.uGlow.value - glowOn) > 1e-3) { U.uGlow.value = glowOn; U.uGlowStart.value = glowStart; dirty = true; }
  if (dirty || moved) {
    const dist = camera.position.distanceTo(t);
    // level of detail: houses and trees near the view centre; far ones become footprints painted on the baseplate
    const rad = Math.max(3.0, dist * 1.7); U.uRad.value = rad * 1000; U.uCen.value.set(t.x * 1000 + M.XC, -t.z * 1000 + M.YC); U.uFar.value = THREE.MathUtils.smoothstep(dist, 16, 26);
    for (const m of sbChunks) m.visible = m.userData.c.distanceTo(v3.set(t.x, 0, t.z)) < rad + 2.9 && U.uFar.value < 0.999;
    for (const m of treeChunks) m.visible = m.userData.c.distanceTo(v3.set(t.x, 0, t.z)) < rad + 2.9 && dist < 30;
    const sd = Math.min(24, Math.max(0.6, dist * 0.95));
    sun.position.copy(t).addScaledVector(SUN_DIR, Math.max(10, dist * 3)); sun.target.position.copy(t);
    const sc = sun.shadow.camera; sc.left = -sd; sc.right = sd; sc.top = sd; sc.bottom = -sd; sc.near = 0.1; sc.far = Math.max(30, dist * 6); sc.updateProjectionMatrix();
    sun.shadow.bias = -0.00002 * sd; sun.shadow.normalBias = 0.0;
    camera.near = Math.max(0.004, dist * 0.02); camera.far = Math.max(60, dist * 12); camera.updateProjectionMatrix();
    renderScene(dist); dirty = false;
    if (++labelTick % 2 === 0 || !moved) updateLabels(innerWidth, innerHeight);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
$('loading').style.opacity = '0'; setTimeout(() => $('loading').remove(), 700);
setTimeout(() => ($('hint').style.opacity = '0'), 10000);
window.__model = { stops, setYear, flyTo, goStop, camState, applyCam, controls, camera, renderer, scene, U, LOOK, gtao, mini, sun, redraw: () => (dirty = true) };
