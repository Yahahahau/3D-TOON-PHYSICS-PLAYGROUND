// Keyboard input. Character A: WASD + Space. Character B: Arrow keys + Right Shift.
// Uses KeyboardEvent.code so it works with any keyboard layout (incl. Thai).

const MAP = {
  a: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], jump: ['Space'] },
  b: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['ShiftRight'] },
};

const GAME_KEYS = new Set(Object.values(MAP).flatMap((m) => Object.values(m).flat()));

export class Keyboard {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set(); // edge-triggered since last consume
    this.hotkeys = new Map();
    this.lastUse = 0;
    this._onDown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.pressed.add(e.code);
        const hk = this.hotkeys.get(e.code);
        if (hk) hk(e);
      }
      this.down.add(e.code);
      this.lastUse = performance.now();
    };
    this._onUp = (e) => this.down.delete(e.code);
    this._onBlur = () => this.down.clear();
    target.addEventListener('keydown', this._onDown, { passive: false });
    target.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onBlur);
    this.target = target;
  }

  onKey(code, fn) {
    this.hotkeys.set(code, fn);
  }

  _any(codes) {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Writes axis + jump state for character id into out. */
  read(id, out) {
    const m = MAP[id];
    const x = (this._any(m.right) ? 1 : 0) - (this._any(m.left) ? 1 : 0);
    const y = (this._any(m.up) ? 1 : 0) - (this._any(m.down) ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    out.x = x / len;
    out.y = y / len;
    out.jumpHeld = this._any(m.jump);
    out.jumpPressed = m.jump.some((c) => this.pressed.has(c));
    return out;
  }

  consume() {
    this.pressed.clear();
  }

  dispose() {
    this.target.removeEventListener('keydown', this._onDown);
    this.target.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onBlur);
  }
}
