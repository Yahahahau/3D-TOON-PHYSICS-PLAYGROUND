import * as THREE from 'three';
import { stampVertex, stampFragment, fadeFragment, fullscreenVertex } from '../shaders/surfaces.js';

const MAX_STAMPS = 384;

/**
 * Top-down "slime thickness" render target covering the arena floor.
 * Trail stamps are drawn with MAX blending (strokes merge into one continuous
 * liquid body) and the whole map is faded with subtractive blending so trails
 * slowly dry out over the configured lifetime. The floor shader turns this
 * map into glossy liquid with normals, highlights and reflections.
 */
export class SlimeMap {
  constructor(renderer, { size, resolution }) {
    this.renderer = renderer;
    this.size = size;
    this.center = new THREE.Vector2(0, 0);
    this.rect = new THREE.Vector4(0, 0, size, 1 / resolution);
    this._createTarget(resolution);

    // ---- stamp batch ----
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    this.aStamp = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aInfo = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aStamp', this.aStamp);
    geo.setAttribute('aInfo', this.aInfo);
    geo.instanceCount = 0;
    this.stampGeo = geo;
    this.stampMesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uSlimeRect: { value: this.rect } },
        vertexShader: stampVertex,
        fragmentShader: stampFragment,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.stampMesh.frustumCulled = false;
    this.stampScene = new THREE.Scene();
    this.stampScene.add(this.stampMesh);

    // ---- fade pass ----
    this.fadeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: { uAmount: { value: 0 } },
        vertexShader: fullscreenVertex,
        fragmentShader: fadeFragment,
        blending: THREE.CustomBlending,
        blendEquation: THREE.ReverseSubtractEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.fadeMesh.frustumCulled = false;
    this.fadeScene = new THREE.Scene();
    this.fadeScene.add(this.fadeMesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.count = 0;
    this.pendingFade = 0;
    this.totalStamps = 0;
    this.needsClear = true;
  }

  _createTarget(resolution) {
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(resolution, resolution, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.rect.w = 1 / resolution;
    this.needsClear = true;
  }

  get texture() {
    return this.rt.texture;
  }

  setResolution(resolution) {
    if (this.rt.width === resolution) return;
    this._createTarget(resolution);
  }

  /** channel 0 = character A colour, 1 = character B colour. */
  stamp(x, z, radius, strength = 1, channel = 0, seed = Math.random()) {
    if (this.count >= MAX_STAMPS) return;
    const i = this.count++;
    const s = this.aStamp.array;
    s[i * 4] = x;
    s[i * 4 + 1] = z;
    s[i * 4 + 2] = radius;
    s[i * 4 + 3] = strength;
    const f = this.aInfo.array;
    f[i * 4] = channel === 0 ? 1 : 0;
    f[i * 4 + 1] = channel === 1 ? 1 : 0;
    f[i * 4 + 2] = seed;
    f[i * 4 + 3] = 0;
    this.totalStamps++;
  }

  clear() {
    this.needsClear = true;
    this.count = 0;
  }

  update(dt, lifetime) {
    const renderer = this.renderer;
    // fade: thickness 1 -> 0 over `lifetime` seconds, quantised to 8-bit steps
    this.pendingFade += dt / Math.max(0.5, lifetime);
    let fade = 0;
    if (this.pendingFade >= 2 / 255) {
      fade = Math.floor(this.pendingFade * 255) / 255;
      this.pendingFade -= fade;
    }
    if (!this.needsClear && fade === 0 && this.count === 0) return;

    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.rt);
    if (this.needsClear) {
      renderer.getClearColor(_cc);
      const a = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.setClearColor(_cc, a);
      this.needsClear = false;
    }
    if (fade > 0) {
      this.fadeMesh.material.uniforms.uAmount.value = fade;
      renderer.render(this.fadeScene, this.camera);
    }
    if (this.count > 0) {
      this.stampGeo.instanceCount = this.count;
      this.aStamp.needsUpdate = true;
      this.aInfo.needsUpdate = true;
      renderer.render(this.stampScene, this.camera);
      this.count = 0;
    }
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAuto;
  }

  dispose() {
    this.rt.dispose();
    this.stampGeo.dispose();
    this.stampMesh.material.dispose();
    this.fadeMesh.geometry.dispose();
    this.fadeMesh.material.dispose();
  }
}

const _cc = new THREE.Color();
