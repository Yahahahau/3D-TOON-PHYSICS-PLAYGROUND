import * as THREE from 'three';

/**
 * Mobile-friendly planar reflection for the horizontal floor (y = height).
 * Renders the scene once from a mirrored camera into a reduced-resolution
 * target (resolution set by Reflection Quality) using an oblique near plane.
 * Objects on layer 1 (floor, decals, blob shadows) are skipped.
 */
export class PlanarReflection {
  constructor(renderer, height = 0) {
    this.renderer = renderer;
    this.height = height;
    this.scale = 0;
    this.rt = null;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(0);
    this.textureMatrix = new THREE.Matrix4();
    this._w = 1;
    this._h = 1;
    const ext = renderer.extensions;
    this.type = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
  }

  get texture() {
    return this.rt ? this.rt.texture : null;
  }

  setQuality(scale) {
    this.scale = scale;
    if (scale <= 0) {
      this.rt?.dispose();
      this.rt = null;
      return;
    }
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(4, 4, { type: this.type, samples: 0, depthBuffer: true });
      this.rt.texture.generateMipmaps = false;
    }
    this.setSize(this._w, this._h);
  }

  setSize(w, h) {
    this._w = w;
    this._h = h;
    if (this.rt) this.rt.setSize(Math.max(16, Math.round(w * this.scale)), Math.max(16, Math.round(h * this.scale)));
  }

  update(scene, camera) {
    if (!this.rt) return;
    const renderer = this.renderer;
    const rc = this.camera;
    const n = _normal.set(0, 1, 0);
    _planePos.set(0, this.height, 0);
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    if (_camPos.y < this.height) return;

    // mirror the camera position across the floor plane
    _view.set(_camPos.x, 2 * this.height - _camPos.y, _camPos.z);

    _rotation.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rotation).add(_camPos);
    _target.set(_look.x, 2 * this.height - _look.y, _look.z);

    rc.position.copy(_view);
    rc.up.set(0, 1, 0).applyMatrix4(_rotation).reflect(n);
    rc.lookAt(_target);
    rc.far = camera.far;
    rc.near = camera.near;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(camera.projectionMatrix);
    rc.projectionMatrix.elements[8] *= -1;
    rc.projectionMatrix.elements[12] *= -1;

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);

    // oblique clip plane so nothing below the floor is reflected
    _plane.setFromNormalAndCoplanarPoint(n, _planePos).applyMatrix4(rc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = rc.projectionMatrix.elements;
    _q4.x = (Math.sign(_clip.x) + pm[8]) / pm[0];
    _q4.y = (Math.sign(_clip.y) + pm[9]) / pm[5];
    _q4.z = -1;
    _q4.w = (1 + pm[10]) / pm[14];
    _clip.multiplyScalar(2 / _clip.dot(_q4));
    pm[2] = _clip.x;
    pm[6] = _clip.y;
    pm[10] = _clip.z + 1 - 0.003;
    pm[14] = _clip.w;

    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, rc);
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.autoUpdate = prevShadow;
  }

  dispose() {
    this.rt?.dispose();
  }
}

const _normal = new THREE.Vector3();
const _planePos = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _view = new THREE.Vector3();
const _look = new THREE.Vector3();
const _target = new THREE.Vector3();
const _rotation = new THREE.Matrix4();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q4 = new THREE.Vector4();
