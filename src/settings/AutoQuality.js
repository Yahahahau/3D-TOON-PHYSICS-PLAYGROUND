import { QUALITY_LEVELS } from './presets.js';

/**
 * Watches the real frame rate and steps graphics down (render scale first,
 * then the quality preset) when the device can't hold ~60 FPS. When there is
 * lots of headroom for a while it steps back up, never above the level the
 * player chose ("ceiling").
 */
export class AutoQuality {
  constructor(settings, notify) {
    this.settings = settings;
    this.notify = notify;
    this.frames = 0;
    this.time = 0;
    this.low = 0;
    this.high = 0;
    this.grace = 4; // seconds to ignore after start / changes (shader compiles)
    this.fps = 60;
    const q = settings.get('quality');
    this.ceiling = QUALITY_LEVELS.includes(q) ? q : 'ultra';
    this.ceilingScale = settings.get('renderScale');
    settings.on('preset', (name, source) => {
      if (source === 'user') {
        this.ceiling = name;
        this.ceilingScale = settings.get('renderScale');
      }
      this.grace = 3;
    });
    settings.on('change', (key, _v, source) => {
      if (source === 'user' && key === 'renderScale') this.ceilingScale = settings.get('renderScale');
      if (source === 'user') this.grace = 3;
    });
  }

  sample(dt, active) {
    if (!active) return;
    if (this.grace > 0) {
      this.grace -= dt;
      this.frames = 0;
      this.time = 0;
      return;
    }
    this.frames++;
    this.time += dt;
    if (this.time < 2) return;
    this.fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    if (!this.settings.get('autoQuality')) return;
    if (this.fps < 47) {
      this.high = 0;
      if (++this.low >= 1) {
        this.low = 0;
        this._down();
      }
    } else if (this.fps > 57.5) {
      this.low = 0;
      if (++this.high >= 6) {
        this.high = 0;
        this._up();
      }
    } else {
      this.low = 0;
      this.high = 0;
    }
  }

  _down() {
    const s = this.settings;
    const scale = s.get('renderScale');
    if (scale > 0.71) {
      s.set('renderScale', Math.round((scale - 0.1) * 100) / 100, { source: 'auto' });
      this.notify?.(`Auto Quality: ลดความละเอียดเป็น ${Math.round(s.get('renderScale') * 100)}%`);
    } else {
      const q = s.get('quality');
      const idx = QUALITY_LEVELS.indexOf(q);
      const next = idx === -1 ? 'medium' : QUALITY_LEVELS[idx - 1];
      if (!next) return;
      s.applyPreset(next, 'auto');
      this.notify?.(`Auto Quality: ปรับกราฟิกเป็น ${next.toUpperCase()}`);
    }
    this.grace = 3;
  }

  _up() {
    const s = this.settings;
    const q = s.get('quality');
    const idx = QUALITY_LEVELS.indexOf(q);
    const ceil = QUALITY_LEVELS.indexOf(this.ceiling);
    if (idx !== -1 && idx < ceil) {
      s.applyPreset(QUALITY_LEVELS[idx + 1], 'auto');
      this.notify?.(`Auto Quality: เพิ่มกราฟิกเป็น ${QUALITY_LEVELS[idx + 1].toUpperCase()}`);
    } else if (s.get('renderScale') < this.ceilingScale - 0.01) {
      s.set('renderScale', Math.min(this.ceilingScale, s.get('renderScale') + 0.1), { source: 'auto' });
    } else return;
    this.grace = 3;
  }
}
