import { Emitter } from '../utils/Emitter.js';
import { storage } from '../utils/storage.js';
import { QUALITY_PRESETS, GRAPHICS_KEYS } from './presets.js';

const STORAGE_KEY = 'toon-physics-playground:settings:v1';

export const PHYSICS_DEFAULTS = {
  gravity: 18, // m/s² — a bit stronger than earth for snappy cartoon arcs
  bounce: 1, // multiplier on every restitution value
  friction: 1, // multiplier on every friction value
  moveSpeed: 1, // multiplier on character speed / acceleration
  slimeLifetime: 12, // seconds before a slime trail has fully dried
};

export const DEFAULTS = {
  quality: 'high',
  autoQuality: true,
  ...QUALITY_PRESETS.high,
  ...PHYSICS_DEFAULTS,
  cameraDistance: 9.5,
  cameraPitch: 32, // degrees
  controlMode: 'dual', // 'dual' | 'single'
  focus: 'both', // 'both' | 'a' | 'b'
};

/**
 * Central reactive settings store. Every system listens to `change` events and
 * applies values live, so every option has a direct effect on the game.
 */
export class Settings extends Emitter {
  constructor(initialQuality) {
    super();
    const saved = storage.get(STORAGE_KEY, null);
    this.values = { ...DEFAULTS };
    if (initialQuality && QUALITY_PRESETS[initialQuality]) {
      this.values.quality = initialQuality;
      Object.assign(this.values, QUALITY_PRESETS[initialQuality]);
    }
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(DEFAULTS)) if (k in saved) this.values[k] = saved[k];
    }
    this._saveTimer = 0;
  }

  get(key) {
    return this.values[key];
  }

  set(key, value, { silent = false, source = 'user' } = {}) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    if (GRAPHICS_KEYS.includes(key) && source === 'user') this.values.quality = 'custom';
    if (source !== 'auto') this._persist();
    if (!silent) this.emit('change', key, value, source);
  }

  applyPreset(name, source = 'user') {
    const preset = QUALITY_PRESETS[name];
    if (!preset) return;
    this.values.quality = name;
    for (const [k, v] of Object.entries(preset)) this.values[k] = v;
    if (source !== 'auto') this._persist();
    this.emit('preset', name, source);
    this.emit('change', 'graphics', null, source);
  }

  resetPhysics() {
    Object.assign(this.values, PHYSICS_DEFAULTS);
    this._persist();
    this.emit('change', 'physics', null, 'user');
  }

  _persist() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => storage.set(STORAGE_KEY, this.values), 250);
  }
}
