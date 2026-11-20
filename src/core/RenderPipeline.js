import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { PIXEL_RATIO_CAP } from '../settings/presets.js';

/**
 * Owns the WebGLRenderer and the frame composition:
 *  - direct rendering (fastest) when no AA / SSAO is requested
 *  - EffectComposer with MSAA render target, optional GTAO (SSAO) and FXAA
 *  - pixel ratio = min(devicePixelRatio, cap for quality) * render scale
 */
export class RenderPipeline {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    renderer.setClearColor('#bfe6ff', 1);
    this.renderer = renderer;
    this.composer = null;
    this.aa = 'off';
    this.ao = 'off';
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;
    this.qualityCap = 'high';
    this.renderScale = 1;
  }

  get isWebGL2() {
    return this.renderer.capabilities.isWebGL2 !== false;
  }

  configure({ scene, camera, antiAliasing, ambientOcclusion, renderScale, quality }) {
    this.scene = scene;
    this.camera = camera;
    this.renderScale = renderScale;
    this.qualityCap = quality in PIXEL_RATIO_CAP ? quality : this.qualityCap;
    const needsComposer = antiAliasing !== 'off' || ambientOcclusion === 'ssao';
    const changed = antiAliasing !== this.aa || ambientOcclusion !== this.ao || needsComposer !== !!this.composer;
    this.aa = antiAliasing;
    this.ao = ambientOcclusion;
    this._applyPixelRatio();
    if (changed) this._buildComposer(needsComposer);
  }

  _applyPixelRatio() {
    const cap = PIXEL_RATIO_CAP[this.qualityCap] ?? 2;
    const dpr = Math.min(window.devicePixelRatio || 1, cap) * this.renderScale;
    this.pixelRatio = Math.max(0.5, dpr);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer?.setPixelRatio(this.pixelRatio);
    this.composer?.setSize(this.width, this.height);
    this._fxaa?.setSize(this.width * this.pixelRatio, this.height * this.pixelRatio);
  }

  _buildComposer(enabled) {
    if (this.composer) {
      this.composer.passes.forEach((p) => p.dispose?.());
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      this.composer = null;
      this._fxaa = null;
      this._gtao = null;
    }
    if (!enabled) return;
    const samples = this.aa === 'msaa' ? 4 : 0;
    const rt = new THREE.WebGLRenderTarget(this.width * this.pixelRatio, this.height * this.pixelRatio, {
      type: THREE.HalfFloatType,
      samples,
    });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.width, this.height);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.ao === 'ssao') {
      const gtao = new GTAOPass(this.scene, this.camera, this.width, this.height);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      composer.addPass(gtao);
      this._gtao = gtao;
    }
    composer.addPass(new OutputPass());
    if (this.aa === 'fxaa') {
      this._fxaa = new FXAAPass();
      composer.addPass(this._fxaa);
    }
    this.composer = composer;
    this._applyPixelRatio();
  }

  setShadowType(quality) {
    const r = this.renderer;
    const enabled = quality !== 'off';
    const type = quality === 'low' ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    if (r.shadowMap.enabled === enabled && r.shadowMap.type === type) return false;
    r.shadowMap.enabled = enabled;
    r.shadowMap.type = type;
    r.shadowMap.needsUpdate = true;
    return true; // caller must recompile materials
  }

  setSize(w, h) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this._applyPixelRatio();
  }

  /** Drawing buffer size in device pixels (for reflection targets etc.) */
  get bufferSize() {
    return { w: Math.round(this.width * this.pixelRatio), h: Math.round(this.height * this.pixelRatio) };
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._buildComposer(false);
    this.renderer.dispose();
  }
}
