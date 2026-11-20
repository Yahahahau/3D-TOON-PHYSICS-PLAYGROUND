// Minimal event emitter.
export class Emitter {
  constructor() {
    this._l = new Map();
  }
  on(type, fn) {
    if (!this._l.has(type)) this._l.set(type, new Set());
    this._l.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this._l.get(type)?.delete(fn);
  }
  emit(type, ...args) {
    const set = this._l.get(type);
    if (set) for (const fn of set) fn(...args);
  }
}
