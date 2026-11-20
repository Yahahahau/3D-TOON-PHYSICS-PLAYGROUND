import { clamp } from '../utils/math.js';

/**
 * Floating virtual joystick bound to a zone element. Each joystick tracks a
 * single pointerId, so two joysticks (and jump buttons) work simultaneously
 * with multitouch. Every way a touch can end (up, cancel, lost capture, blur,
 * page hidden) resets the stick, so it can never get stuck.
 */
export class Joystick {
  constructor(zone, { color, label }) {
    this.zone = zone;
    this.pointerId = null;
    this.value = { x: 0, y: 0 };
    this.raw = { x: 0, y: 0 };
    this.cx = 0;
    this.cy = 0;

    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.base.style.setProperty('--joy-color', color);
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.labelEl = document.createElement('div');
    this.labelEl.className = 'joy-label';
    this.labelEl.textContent = label;
    this.base.append(this.knob, this.labelEl);
    zone.appendChild(this.base);
    this._placeHome();

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    zone.addEventListener('pointerdown', this._down);
    zone.addEventListener('pointermove', this._move);
    zone.addEventListener('pointerup', this._up);
    zone.addEventListener('pointercancel', this._up);
    zone.addEventListener('lostpointercapture', this._up);
    this._reset = () => this.release();
    window.addEventListener('blur', this._reset);
    document.addEventListener('visibilitychange', this._reset);
    window.addEventListener('resize', this._reset);
  }

  setLabel(label, color) {
    this.labelEl.textContent = label;
    if (color) this.base.style.setProperty('--joy-color', color);
  }

  get radius() {
    return this.base.offsetWidth * 0.5 || 58;
  }

  _placeHome() {
    // resting position: lower inner corner of the zone (thumb friendly)
    const z = this.zone.getBoundingClientRect();
    const r = this.radius;
    const left = this.zone.classList.contains('left');
    const safe = 18;
    this.homeX = left ? r + safe + 8 : z.width - r - safe - 8;
    this.homeY = z.height - r - safe - 22;
    this.base.style.left = `${this.homeX}px`;
    this.base.style.top = `${this.homeY}px`;
  }

  _down(e) {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers throw for synthetic pointers */
    }
    const z = this.zone.getBoundingClientRect();
    const r = this.radius;
    this.cx = clamp(e.clientX - z.left, r * 0.6, z.width - r * 0.6);
    this.cy = clamp(e.clientY - z.top, r * 0.6, z.height - r * 0.4);
    this.base.style.left = `${this.cx}px`;
    this.base.style.top = `${this.cy}px`;
    this.base.classList.add('active');
    this._update(e);
  }

  _move(e) {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this._update(e);
  }

  _up(e) {
    if (e.pointerId !== this.pointerId) return;
    try {
      if (this.zone.hasPointerCapture(e.pointerId)) this.zone.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.release();
  }

  _update(e) {
    const z = this.zone.getBoundingClientRect();
    const r = this.radius;
    let dx = e.clientX - z.left - this.cx;
    let dy = e.clientY - z.top - this.cy;
    const len = Math.hypot(dx, dy);
    const max = r * 0.9;
    if (len > max) {
      dx *= max / len;
      dy *= max / len;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // normalised, dead zone + smooth response curve for fine control
    let nx = dx / max;
    let ny = -dy / max;
    const m = Math.hypot(nx, ny);
    const dead = 0.1;
    if (m < dead) {
      nx = ny = 0;
    } else {
      const k = Math.pow((m - dead) / (1 - dead), 1.25) / m;
      nx *= k;
      ny *= k;
    }
    this.raw.x = nx;
    this.raw.y = ny;
  }

  release() {
    this.pointerId = null;
    this.raw.x = this.raw.y = 0;
    this.knob.style.transform = 'translate(0px, 0px)';
    this.base.classList.remove('active');
    this._placeHome();
  }

  /** Smoothed value (called once per frame). */
  sample(dt) {
    const k = 1 - Math.exp(-28 * dt);
    this.value.x += (this.raw.x - this.value.x) * k;
    this.value.y += (this.raw.y - this.value.y) * k;
    if (this.pointerId === null && Math.abs(this.value.x) < 0.01 && Math.abs(this.value.y) < 0.01) this.value.x = this.value.y = 0;
    return this.value;
  }

  dispose() {
    window.removeEventListener('blur', this._reset);
    document.removeEventListener('visibilitychange', this._reset);
    window.removeEventListener('resize', this._reset);
    this.base.remove();
  }
}
