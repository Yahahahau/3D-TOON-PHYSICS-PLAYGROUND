/**
 * requestAnimationFrame loop with a fixed physics timestep.
 *   preUpdate(dt)      — once per frame (input sampling)
 *   fixedUpdate(h)     — 0..maxSteps times per frame at exactly `step` seconds
 *   render(dt, alpha)  — once per frame; alpha = interpolation factor between
 *                        the previous and current physics state
 * Large hitches (tab switches, GC) are clamped so physics never "spirals".
 */
export class FixedLoop {
  constructor({ step, maxSteps = 5, preUpdate, fixedUpdate, render, isPaused }) {
    this.step = step;
    this.maxSteps = maxSteps;
    this.preUpdate = preUpdate;
    this.fixedUpdate = fixedUpdate;
    this.render = render;
    this.isPaused = isPaused || (() => false);
    this.acc = 0;
    this.alpha = 0;
    this.running = false;
    this._raf = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  resetClock() {
    this.last = performance.now();
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    this.preUpdate?.(dt);
    if (!this.isPaused()) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= this.step && n < this.maxSteps) {
        this.fixedUpdate(this.step);
        this.acc -= this.step;
        n++;
      }
      if (n === this.maxSteps && this.acc > this.step) this.acc = this.acc % this.step;
      this.alpha = this.acc / this.step;
    }
    this.render(dt, this.alpha);
  }
}
