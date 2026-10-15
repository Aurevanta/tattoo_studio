/**
 * The 3D scene of the limb preview (TASK-0102, TASK-0103, ADR-0033): a reference lower leg or
 * forearm the client turns round, with the design laid on its skin in true millimetres.
 *
 * Loaded only in the browser, on demand, so three.js stays out of every other page's bundle. It
 * reads the model and the design's own master (same origin) and sends nothing anywhere: no
 * photograph is involved and no provider is called.
 *
 * The ink is the shader's version of `designCoordinate` (limb-wrap.ts) and the same multiply the 2D
 * mockup uses: the design is sampled, never redrawn (MOCKUP-INV-001).
 */
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  CanvasTexture,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  limbModelUrl,
  readLimbModel,
  SKIN_TONES,
  type Limb,
  type LimbModel,
  type LimbPlacement,
  type LimbSide,
  type SkinTone,
} from './limb-wrap';

export interface LimbScene {
  model: LimbModel;
  setPlacement(placement: LimbPlacement): void;
  setSide(side: LimbSide): void;
  setTone(tone: SkinTone): void;
  /** Turn the camera to look at this fraction around the limb (see `LIMBS[limb].views`). */
  view(around: number): void;
  dispose(): void;
}

/** True when this browser can draw WebGL at all. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const VERTEX_HEAD = /* glsl */ `
attribute vec2 _ring;
attribute float _perim;
attribute float _height;
varying vec2 vRing;
varying float vPerim;
varying float vHeight;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uDesign;
uniform float uAround;
uniform float uHeight;
uniform vec2 uSize;
uniform float uMirror;
uniform float uWrap;
uniform float uAngle;
varying vec2 vRing;
varying float vPerim;
varying float vHeight;
`;

// The shader twin of designCoordinate(): arc length around the skin, height along the axis.
const FRAGMENT_INK = /* glsl */ `
{
  float s = atan(vRing.y, vRing.x) / 6.28318530718;
  float turn = fract(s - uAround + 0.5) - 0.5;
  float across = turn * vPerim * uMirror;
  // TASK-0105: a sleeve's row goes once round the limb at its own height (uWrap = 1); any other
  // design keeps its millimetres across the skin.
  // The coordinate jumps on the far side of the ring, so its screen derivatives are taken from
  // the ring vector, which is continuous: mipmaps then work without drawing a seam.
  float ds = (vRing.x * dFdx(vRing.y) - vRing.y * dFdx(vRing.x)) / (6.28318530718 * dot(vRing, vRing));
  float dt = (vRing.x * dFdy(vRing.y) - vRing.y * dFdy(vRing.x)) / (6.28318530718 * dot(vRing, vRing));
  vec2 duv;
  vec2 gx;
  vec2 gy;
  if (uWrap > 0.5) {
    duv = vec2(turn * uMirror + 0.5, 0.5 - (vHeight - uHeight) / uSize.y);
    gx = vec2(ds * uMirror, -dFdx(vHeight) / uSize.y);
    gy = vec2(dt * uMirror, -dFdy(vHeight) / uSize.y);
  } else {
    // TASK-0112: in mm across the skin and up the limb, turned clockwise as seen from outside,
    // with the screen gradients turned alike.
    float c = cos(uAngle);
    float sn = sin(uAngle);
    vec2 p = vec2(across, vHeight - uHeight);
    vec2 px = vec2(ds * vPerim * uMirror, dFdx(vHeight));
    vec2 py = vec2(dt * vPerim * uMirror, dFdy(vHeight));
    p = vec2(p.x * c - p.y * sn, p.x * sn + p.y * c);
    px = vec2(px.x * c - px.y * sn, px.x * sn + px.y * c);
    py = vec2(py.x * c - py.y * sn, py.x * sn + py.y * c);
    duv = vec2(p.x / uSize.x + 0.5, 0.5 - p.y / uSize.y);
    gx = vec2(px.x / uSize.x, -px.y / uSize.y);
    gy = vec2(py.x / uSize.x, -py.y / uSize.y);
  }
  if (duv.x >= 0.0 && duv.x <= 1.0 && duv.y >= 0.0 && duv.y <= 1.0) {
    vec4 art = textureGrad(uDesign, duv, gx, gy);
    // Paper reads as no ink; the multiply is the 2D mockup's, a touch under full strength because
    // ink sits beneath the skin's surface.
    vec3 ink = mix(vec3(1.0), art.rgb, art.a * 0.94);
    diffuseColor.rgb *= ink;
  }
}
`;

export async function createLimbScene(
  container: HTMLElement,
  limb: Limb,
  /** TASK-0111: the artwork as the mockup draws it (`loadArtwork`). */
  artwork: HTMLCanvasElement,
  initial: { placement: LimbPlacement; side: LimbSide; tone: SkinTone },
  body?: 'masculine' | 'feminine',
): Promise<LimbScene> {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.add(new HemisphereLight(0xfff4ea, 0x2a2420, 1.4));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(600, 900, 900);
  scene.add(key);
  const rim = new DirectionalLight(0xbcd4ff, 1.1);
  rim.position.set(-700, 400, -800);
  scene.add(rim);

  const camera = new PerspectiveCamera(30, 1, 10, 6000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 300;
  controls.maxDistance = 1800;
  controls.minPolarAngle = Math.PI * 0.18;
  controls.maxPolarAngle = Math.PI * 0.82;

  let gltf: GLTF;
  let design: Texture;
  let model: LimbModel;
  try {
    [gltf, design] = await Promise.all([
      new GLTFLoader().loadAsync(limbModelUrl(limb, body)),
      Promise.resolve(new CanvasTexture(artwork)),
    ]);
    model = readLimbModel(gltf.scene.userData);
    if (model.limb !== limb) throw new Error(`Expected the ${limb} model.`);
  } catch (error) {
    // Nothing is left behind when the model or the design does not load.
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }
  prepareTexture(design, renderer.capabilities.getMaxAnisotropy());

  const uniforms = {
    uDesign: { value: design },
    uAround: { value: initial.placement.around },
    uHeight: { value: initial.placement.heightMm },
    uSize: { value: [initial.placement.widthMm, initial.placement.lengthMm] },
    uMirror: { value: initial.side === 'left' ? 1 : -1 },
    uWrap: { value: initial.placement.wraps ? 1 : 0 },
    uAngle: { value: ((initial.placement.angle ?? 0) * Math.PI) / 180 },
  };
  const skin = new MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  skin.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      VERTEX_HEAD +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRing = _ring; vPerim = _perim; vHeight = _height;',
      );
    shader.fragmentShader =
      FRAGMENT_HEAD +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${FRAGMENT_INK}`,
      );
  };

  let mesh: Mesh | undefined;
  gltf.scene.traverse((node) => {
    if (node instanceof Mesh && !mesh) mesh = node;
  });
  if (!mesh) throw new Error('The limb model has no mesh.');
  mesh.material = skin;
  scene.add(gltf.scene);

  const bounds = new Box3().setFromObject(gltf.scene);
  const centre = bounds.getCenter(new Vector3());
  controls.target.copy(centre);

  const setTone = (tone: SkinTone) => {
    skin.color = new Color(SKIN_TONES.find((t) => t.key === tone)!.colour);
  };
  const setSide = (side: LimbSide) => {
    // The right limb is the left one mirrored; the design is mirrored back so it reads correctly.
    gltf.scene.scale.x = side === 'left' ? 1 : -1;
    uniforms.uMirror.value = side === 'left' ? 1 : -1;
  };
  setTone(initial.tone);
  setSide(initial.side);

  let distance = 1250;
  const view = (around: number) => {
    const side = gltf.scene.scale.x;
    const angle = around * Math.PI * 2;
    // around 0 faces +Z, 0.25 faces +X on the left limb and −X on the right.
    camera.position.set(
      centre.x + Math.sin(angle) * distance * side,
      centre.y + 60,
      centre.z + Math.cos(angle) * distance,
    );
    controls.update();
  };

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Keep the whole limb in frame however narrow the screen.
    const fit = (bounds.max.y - bounds.min.y) * 0.62;
    const vertical = (camera.fov * Math.PI) / 360;
    const needed = fit / Math.tan(vertical) / Math.min(1, camera.aspect * 1.6);
    distance = Math.min(controls.maxDistance, Math.max(controls.minDistance, needed));
    camera.updateProjectionMatrix();
  };
  resize();
  view(initial.placement.around);
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  let frame = 0;
  const loop = () => {
    frame = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  return {
    model,
    setPlacement(placement) {
      uniforms.uAround.value = placement.around;
      uniforms.uHeight.value = placement.heightMm;
      uniforms.uSize.value = [placement.widthMm, placement.lengthMm];
      uniforms.uWrap.value = placement.wraps ? 1 : 0;
      uniforms.uAngle.value = ((placement.angle ?? 0) * Math.PI) / 180;
    },
    setSide,
    setTone,
    view,
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      design.dispose();
      skin.dispose();
      mesh?.geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function prepareTexture(texture: Texture, anisotropy: number): void {
  texture.colorSpace = SRGBColorSpace;
  // Fine line work drawn small on screen needs mipmaps, or it sparkles; the shader passes its own
  // gradients so the jump on the far side of the ring does not pick a blurred level.
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = anisotropy;
  // Row 0 of the image is the design's top, as v = 0 is in designCoordinate().
  texture.flipY = false;
  texture.needsUpdate = true;
}
