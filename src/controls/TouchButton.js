/** Press-and-hold touch button (jump). Tracks its own pointer so it works alongside joysticks. */
export class TouchButton {
  constructor(el) {
    this.el = el;
    this.pointerId = null;
    this.held = false;
    this.pressedFlag = false;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.held = true;
      this.pressedFlag = true;
      el.classList.add('pressed');
    };
    const up = (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.release();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this._reset = () => this.release();
    window.addEventListener('blur', this._reset);
    document.addEventListener('visibilitychange', this._reset);
  }

  release() {
    this.pointerId = null;
    this.held = false;
    this.el.classList.remove('pressed');
  }

  consumePressed() {
    const p = this.pressedFlag;
    this.pressedFlag = false;
    return p;
  }
}
