import * as THREE from 'three';
import { clamp, damp } from '../utils/math.js';

const DEG = Math.PI / 180;
const _mid = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _off = new THREE.Vector3();

/**
 * Smooth third-person orbit camera.
 * - follows the interpolated (render-rate) character position -> no physics jitter
 * - focus: both characters (auto-framing), or only A / only B
 * - drag to orbit, wheel / pinch to zoom; distance & pitch also from settings
 * - in portrait touch layouts the view is offset so characters sit above the thumbs
 */
export class CameraRig {
  constructor(camera, dom, settings) {
    this.camera = camera;
    this.dom = dom;
    this.settings = settings;
    this.yaw = 0;
    this.pitch = settings.get('cameraPitch') * DEG;
    this.userDistance = settings.get('cameraDistance');
    this.distance = this.userDistance;
    this.target = new THREE.Vector3(0, 1, 5);
    this.lookAhead = new THREE.Vector3();
    this.viewOffsetY = 0;
    this._pointers = new Map();
    this._pinch = 0;
    this._bind();
    settings.on('change', (k, v) => {
      if (k === 'cameraDistance') this.userDistance = v;
      if (k === 'cameraPitch') this.pitch = v * DEG;
    });
  }

  _bind() {
    const el = this.dom;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 2) this._pinch = this._pinchDist();
    });
    el.addEventListener('pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this._pointers.size === 1) {
        this.yaw -= dx * 0.0065;
        this.pitch = clamp(this.pitch + dy * 0.0045, 6 * DEG, 78 * DEG);
      } else if (this._pointers.size === 2) {
        const d = this._pinchDist();
        if (this._pinch > 0 && d > 0) this.userDistance = clamp(this.userDistance * (this._pinch / d), 4, 30);
        this._pinch = d;
      }
    });
    const end = (e) => {
      this._pointers.delete(e.pointerId);
      this._pinch = this._pointers.size === 2 ? this._pinchDist() : 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.userDistance = clamp(this.userDistance * (1 + Math.sign(e.deltaY) * 0.08), 4, 30);
      },
      { passive: false },
    );
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this._pointers.clear());
  }

  _pinchDist() {
    const pts = [...this._pointers.values()];
    return pts.length < 2 ? 0 : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  rotate(dYaw) {
    this.yaw += dYaw;
  }

  reset() {
    this.yaw = 0;
    this.pitch = this.settings.get('cameraPitch') * DEG;
    this.userDistance = this.settings.get('cameraDistance');
  }

  snap(chars, focus) {
    this._computeGoal(chars, focus, _mid);
    this.target.copy(_mid);
    this.distance = this._goalDistance;
    this.update(0, chars, focus);
  }

  _computeGoal(chars, focus, out) {
    const [a, b] = chars;
    const portrait = this.camera.aspect < 1;
    if (focus === 'a' || focus === 'b') {
      const c = focus === 'a' ? a : b;
      out.copy(c.position);
      _vel.copy(c.anim.vel).setY(0).multiplyScalar(0.18);
      if (_vel.length() > 1.6) _vel.setLength(1.6);
      this._goalDistance = this.userDistance;
    } else {
      out.copy(a.position).add(b.position).multiplyScalar(0.5);
      _vel.copy(a.anim.vel).add(b.anim.vel).setY(0).multiplyScalar(0.07);
      // auto framing: pull back until both characters fit the narrower FOV
      const sep = a.position.distanceTo(b.position);
      const vHalf = (this.camera.fov * DEG) / 2;
      const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
      const half = Math.min(vHalf, hHalf);
      const need = (sep * 0.5 + 1.6) / Math.tan(half) * (portrait ? 1.0 : 0.95);
      this._goalDistance = clamp(Math.max(this.userDistance, need), 4, 60);
    }
    out.y += 0.6;
    this.lookAhead.lerp(_vel, 0.1);
    out.add(this.lookAhead);
    return out;
  }

  update(dt, chars, focus) {
    this._computeGoal(chars, focus, _mid);
    // horizontal follow is snappier than vertical (bounces don't shake the view)
    const kh = dt > 0 ? damp(7, dt) : 1;
    const kv = dt > 0 ? damp(3.5, dt) : 1;
    this.target.x += (_mid.x - this.target.x) * kh;
    this.target.z += (_mid.z - this.target.z) * kh;
    this.target.y += (_mid.y - this.target.y) * kv;
    this.distance += (this._goalDistance - this.distance) * (dt > 0 ? damp(4, dt) : 1);

    const cp = Math.cos(this.pitch);
    _off.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.distance);
    const cam = this.camera;
    cam.position.copy(this.target).add(_off);
    if (cam.position.y < 0.6) cam.position.y = 0.6;
    cam.lookAt(this.target);
    cam.updateMatrixWorld();
  }

  /** Portrait touch layouts: shift the projection so the action sits above the controls. */
  setLayout(width, height, touchUI) {
    const cam = this.camera;
    cam.aspect = width / height;
    cam.fov = cam.aspect < 0.8 ? 62 : cam.aspect < 1.3 ? 55 : 48;
    const offset = touchUI && cam.aspect < 1 ? 0.13 : touchUI ? 0.06 : 0;
    if (offset > 0) cam.setViewOffset(width, height, 0, height * offset, width, height);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }
}
