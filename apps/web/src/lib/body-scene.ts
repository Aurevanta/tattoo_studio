/**
 * The 3D scene of the whole-body preview (TASK-0109, ADR-0037): one reference body the client
 * turns round, with the design laid on the chosen zone in millimetres.
 *
 * Loaded only in the browser, on demand, so three.js stays out of every other page's bundle. It
 * reads the model and the design's own master (same origin) and sends nothing anywhere: no
 * photograph is involved and no provider is called.
 *
 * The ink is the shader's version of `designCoordinate` (body-zones.ts) and the same multiply the
 * 2D mockup uses: the design is sampled, never redrawn (MOCKUP-INV-001).
 */
import {
  ACESFilmicToneMapping,
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
  TextureLoader,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  BODY_MODEL_URL,
  readBodyModel,
  viewDistance,
  type BodyModel,
  type BodyPlacement,
  type BodySide,
} from './body-zones';
import { SKIN_TONES, type SkinTone } from './limb-wrap';

export interface BodyScene {
  model: BodyModel;
  setPlacement(placement: BodyPlacement): void;
  setSide(side: BodySide): void;
  setTone(tone: SkinTone): void;
  /** Look at the zone from outside; `whole` steps back to show the entire body. */
  view(whole?: boolean): void;
  dispose(): void;
}

const VERTEX_HEAD = /* glsl */ `
varying vec3 vBodyPosition;
varying vec3 vBodyNormal;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uDesign;
uniform float uMode;
uniform vec3 uOrigin;
uniform vec3 uNormal;
uniform vec3 uUp;
uniform vec3 uRight;
uniform vec2 uSlab;
uniform float uRadius;
uniform vec2 uOffset;
uniform float uAngle;
uniform vec2 uSize;
uniform float uMirror;
varying vec3 vBodyPosition;
varying vec3 vBodyNormal;
`;

// The shader twin of designCoordinate(): plane decal or arc round a limb's axis, in mm.
const FRAGMENT_INK = /* glsl */ `
{
  vec3 v = vBodyPosition - uOrigin;
  float x = 0.0;
  float y = 0.0;
  bool inside = true;
  if (uMode < 0.5) {
    float depth = dot(v, uNormal);
    inside = depth >= -uSlab.x && depth <= uSlab.y && dot(normalize(vBodyNormal), uNormal) >= 0.15;
    x = dot(v, uRight);
    y = dot(v, uUp);
  } else {
    y = dot(v, uUp);
    vec3 perp = v - uUp * y;
    float r = length(perp);
    inside = r <= uRadius;
    x = atan(dot(perp, uRight), dot(perp, uNormal)) * r;
  }
  if (inside) {
    x *= uMirror;
    vec2 d = vec2(x, y) - uOffset;
    float c = cos(uAngle);
    float s = sin(uAngle);
    vec2 q = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
    vec2 duv = vec2(q.x / uSize.x + 0.5, 0.5 - q.y / uSize.y);
    if (duv.x >= 0.0 && duv.x <= 1.0 && duv.y >= 0.0 && duv.y <= 1.0) {
      vec4 art = texture2D(uDesign, duv);
      // Paper reads as no ink; the multiply is the 2D mockup's, a touch under full strength
      // because ink sits beneath the skin's surface.
      vec3 ink = mix(vec3(1.0), art.rgb, art.a * 0.94);
      diffuseColor.rgb *= ink;
    }
  }
}
`;

export async function createBodyScene(
  container: HTMLElement,
  zoneName: string,
  designUrl: string,
  initial: { placement: BodyPlacement; side: BodySide; tone: SkinTone },
): Promise<BodyScene> {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.add(new HemisphereLight(0xfff4ea, 0x2a2420, 1.4));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(900, 1900, 1400);
  scene.add(key);
  const rim = new DirectionalLight(0xbcd4ff, 1.1);
  rim.position.set(-900, 1200, -1400);
  scene.add(rim);

  const camera = new PerspectiveCamera(30, 1, 10, 12000);
  // A light that goes with the camera, so a zone facing away from the key light (the back of a
  // hand, a wrist) is never shown in shadow.
  const headlight = new DirectionalLight(0xffffff, 0.9);
  headlight.position.set(0, 0, 1);
  headlight.target.position.set(0, 0, -1);
  camera.add(headlight, headlight.target);
  scene.add(camera);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 200;
  controls.maxDistance = 5200;

  let model: BodyModel;
  let design: Texture;
  let root: Awaited<ReturnType<GLTFLoader['loadAsync']>>['scene'];
  try {
    const [gltf, texture] = await Promise.all([
      new GLTFLoader().loadAsync(BODY_MODEL_URL),
      new TextureLoader().loadAsync(designUrl),
    ]);
    model = readBodyModel(gltf.scene.userData);
    if (!model.zones[zoneName]) throw new Error(`The body has no zone ${zoneName}.`);
    design = texture;
    root = gltf.scene;
  } catch (error) {
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }
  const zone = model.zones[zoneName]!;
  design.colorSpace = SRGBColorSpace;
  design.generateMipmaps = true;
  design.minFilter = LinearMipmapLinearFilter;
  design.magFilter = LinearFilter;
  design.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // Row 0 of the image is the design's top, as v = 0 is in designCoordinate().
  design.flipY = false;
  design.needsUpdate = true;

  const uniforms = {
    uDesign: { value: design },
    uMode: { value: zone.mode === 'plane' ? 0 : 1 },
    uOrigin: { value: new Vector3(...zone.origin) },
    uNormal: { value: new Vector3(...zone.normal) },
    uUp: { value: new Vector3(...zone.up) },
    uRight: { value: new Vector3(...zone.right) },
    uSlab: { value: [zone.behindMm ?? 140, zone.frontMm ?? 40] },
    uRadius: { value: zone.radiusMm ?? 80 },
    uOffset: { value: [0, 0] },
    uAngle: { value: 0 },
    uSize: { value: [initial.placement.widthMm, initial.placement.heightMm] },
    uMirror: { value: 1 },
  };
  const skin = new MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  skin.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      VERTEX_HEAD +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvBodyPosition = position; vBodyNormal = normal;',
      );
    shader.fragmentShader =
      FRAGMENT_HEAD +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${FRAGMENT_INK}`,
      );
  };
  let mesh: Mesh | undefined;
  root.traverse((node) => {
    if (node instanceof Mesh && !mesh) mesh = node;
  });
  if (!mesh) throw new Error('The body model has no mesh.');
  mesh.material = skin;
  scene.add(root);

  let side: BodySide = initial.side;
  let whole = false;
  const setPlacement = (p: BodyPlacement) => {
    uniforms.uOffset.value = [p.xMm, p.yMm];
    uniforms.uAngle.value = (p.angle * Math.PI) / 180;
    uniforms.uSize.value = [p.widthMm, p.heightMm];
  };
  const setTone = (tone: SkinTone) => {
    skin.color = new Color(SKIN_TONES.find((t) => t.key === tone)!.colour);
  };
  const setSide = (next: BodySide) => {
    // The right side is the left one mirrored; the design is mirrored back so it reads correctly.
    side = next;
    const m = next === 'left' || !zone.paired ? 1 : -1;
    root.scale.x = m;
    uniforms.uMirror.value = m;
  };
  setPlacement(initial.placement);
  setTone(initial.tone);
  setSide(initial.side);

  const view = (all = false) => {
    whole = all;
    const m = side === 'left' || !zone.paired ? 1 : -1;
    const [sx, sy, sz] = zone.surface;
    const [nx, ny, nz] = zone.view ?? zone.normal;
    if (all) {
      const centre = new Vector3(0, model.heightMm / 2, 0);
      controls.target.copy(centre);
      const out = new Vector3(nx * m, 0, nz).normalize();
      if (out.lengthSq() < 0.1) out.set(0, 0, 1);
      camera.position.copy(centre).addScaledVector(out, 4200);
    } else {
      const target = new Vector3(sx * m, sy, sz);
      controls.target.copy(target);
      const d = viewDistance({
        widthMm: uniforms.uSize.value[0]!,
        heightMm: uniforms.uSize.value[1]!,
      });
      camera.position.copy(target).addScaledVector(new Vector3(nx * m, ny, nz).normalize(), d);
    }
    controls.update();
  };

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  view(false);
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
    setPlacement,
    setSide(next) {
      setSide(next);
      view(whole);
    },
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
