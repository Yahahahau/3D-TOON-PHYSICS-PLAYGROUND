import { ICONS } from './icons.js';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};

/**
 * Settings sheet with three tabs (Graphics / Physics / Controls & Camera).
 * Every control writes straight into the Settings store; the game applies
 * each change live.
 */
export class SettingsPanel {
  constructor(game, root) {
    this.game = game;
    this.settings = game.settings;
    this.controls = [];

    this.overlay = h('div', 'overlay');
    const sheet = h('div', 'sheet');
    const head = h('div', 'sheet-head', '<h2>⚙️ ตั้งค่า</h2>');
    const close = h('button', 'icon-btn', ICONS.close);
    close.setAttribute('aria-label', 'ปิด');
    close.addEventListener('click', () => this.close());
    head.appendChild(close);
    const tabs = h('div', 'tabs');
    const body = h('div', 'sheet-body');
    sheet.append(head, tabs, body);
    this.overlay.appendChild(sheet);
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) this.close();
    });
    root.appendChild(this.overlay);

    const pages = {
      graphics: { label: '🎨 กราฟิก', el: h('div') },
      physics: { label: '🧪 ฟิสิกส์', el: h('div') },
      controls: { label: '🎮 ควบคุม', el: h('div') },
    };
    for (const [key, p] of Object.entries(pages)) {
      const t = h('button', 'tab', p.label);
      t.addEventListener('click', () => {
        for (const [k2, p2] of Object.entries(pages)) {
          p2.el.style.display = k2 === key ? '' : 'none';
          p2.tab.classList.toggle('active', k2 === key);
        }
        body.scrollTop = 0;
      });
      p.tab = t;
      tabs.appendChild(t);
      body.appendChild(p.el);
    }
    pages.graphics.tab.click();

    this._buildGraphics(pages.graphics.el);
    this._buildPhysics(pages.physics.el);
    this._buildControls(pages.controls.el);

    this.settings.on('change', () => this.sync());
    this.settings.on('preset', () => this.sync());
    this.sync();
  }

  open() {
    this.sync();
    this.overlay.classList.add('open');
  }

  close() {
    this.overlay.classList.remove('open');
  }

  get isOpen() {
    return this.overlay.classList.contains('open');
  }

  // ---------------------------------------------------------------- builders
  _title(parent, text) {
    parent.appendChild(h('div', 'group-title', text));
  }

  _row(parent, label, hint) {
    const row = h('div', 'row');
    row.appendChild(h('label', null, hint ? `${label}<small>${hint}</small>` : label));
    parent.appendChild(row);
    return row;
  }

  _seg(parent, label, key, options, hint, onPick) {
    const row = this._row(parent, label, hint);
    const seg = h('div', 'seg');
    const buttons = options.map(([value, text]) => {
      const b = h('button', null, text);
      b.type = 'button';
      b.addEventListener('click', () => (onPick ? onPick(value) : this.settings.set(key, value)));
      seg.appendChild(b);
      return { b, value };
    });
    row.appendChild(seg);
    this.controls.push(() => {
      const cur = this.settings.get(key);
      for (const { b, value } of buttons) b.classList.toggle('on', value === cur);
    });
  }

  _slider(parent, label, key, { min, max, step, fmt = (v) => v, hint }) {
    const row = this._row(parent, label, hint);
    const wrap = h('div', 'slider');
    const input = h('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    const out = h('output');
    const paint = () => {
      const v = parseFloat(input.value);
      input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
      out.textContent = fmt(v);
    };
    input.addEventListener('input', () => {
      paint();
      this.settings.set(key, parseFloat(input.value));
    });
    wrap.append(input, out);
    row.appendChild(wrap);
    this.controls.push(() => {
      input.value = this.settings.get(key);
      paint();
    });
  }

  _switch(parent, label, key, hint) {
    const row = this._row(parent, label, hint);
    const sw = h('label', 'switch', '<input type="checkbox"><span></span>');
    const input = sw.querySelector('input');
    input.addEventListener('change', () => this.settings.set(key, input.checked));
    row.appendChild(sw);
    this.controls.push(() => (input.checked = !!this.settings.get(key)));
  }

  _buildGraphics(el) {
    this._title(el, 'Graphics Quality');
    this._seg(
      el,
      'ระดับกราฟิก',
      'quality',
      [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']],
      null,
      (v) => this.settings.applyPreset(v, 'user'),
    );
    this.customNote = h('div', 'note', '');
    el.appendChild(this.customNote);
    this._switch(el, 'Auto Quality', 'autoQuality', 'ลดกราฟิกอัตโนมัติเมื่อ FPS ตก');

    this._title(el, 'Graphics Settings');
    this._seg(el, 'Shadow Quality', 'shadowQuality', [['off', 'Off'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']]);
    this._seg(el, 'Shadow Resolution', 'shadowResolution', [[512, '512'], [1024, '1K'], [2048, '2K'], [4096, '4K']]);
    this._seg(el, 'Reflection Quality', 'reflectionQuality', [['off', 'Off'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']], 'เงาสะท้อนพื้นเปียก');
    this._seg(el, 'Ambient Occlusion', 'ambientOcclusion', [['off', 'Off'], ['contact', 'Contact'], ['ssao', 'SSAO']]);
    this._seg(el, 'Particle Quality', 'particleQuality', [['low', 'Low'], ['medium', 'Med'], ['high', 'High'], ['ultra', 'Ultra']], 'จำนวนหยดเมือก');
    this._seg(el, 'Texture Quality', 'textureQuality', [['low', 'Low'], ['medium', 'Med'], ['high', 'High']], 'รวมความละเอียดรอยเมือก');
    this._slider(el, 'Render Resolution', 'renderScale', { min: 0.5, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` });
    this._seg(el, 'Anti-Aliasing', 'antiAliasing', [['off', 'Off'], ['fxaa', 'FXAA'], ['msaa', 'MSAA']]);
  }

  _buildPhysics(el) {
    this._title(el, 'Physics Settings');
    this._slider(el, 'Gravity', 'gravity', { min: 2, max: 35, step: 0.5, fmt: (v) => `${v.toFixed(1)} m/s²`, hint: 'แรงโน้มถ่วง' });
    this._slider(el, 'Bounce Strength', 'bounce', { min: 0, max: 2, step: 0.05, fmt: (v) => `×${v.toFixed(2)}`, hint: 'ความเด้งทุกพื้นผิว' });
    this._slider(el, 'Friction', 'friction', { min: 0, max: 2, step: 0.05, fmt: (v) => `×${v.toFixed(2)}`, hint: 'แรงเสียดทาน' });
    this._slider(el, 'Movement Speed', 'moveSpeed', { min: 0.4, max: 2, step: 0.05, fmt: (v) => `×${v.toFixed(2)}`, hint: 'ความเร็วตัวละคร' });
    this._slider(el, 'Slime Lifetime', 'slimeLifetime', { min: 2, max: 40, step: 1, fmt: (v) => `${v}s`, hint: 'เวลาที่รอยเมือกคงอยู่' });
    const row = h('div', 'btn-row');
    const reset = h('button', 'btn', 'คืนค่าฟิสิกส์เริ่มต้น');
    reset.addEventListener('click', () => this.settings.resetPhysics());
    row.appendChild(reset);
    el.appendChild(row);
  }

  _buildControls(el) {
    this._title(el, 'Controls');
    this._seg(el, 'โหมดควบคุม (มือถือ)', 'controlMode', [['dual', '2 ตัว'], ['single', '1 ตัว']], 'จอเล็กใช้ 1 ตัว + ปุ่มสลับ');
    this._seg(el, 'กล้องติดตาม', 'focus', [['both', 'ทั้งคู่'], ['a', 'Bloop'], ['b', 'Glub']]);
    this._title(el, 'Camera');
    this._slider(el, 'ระยะกล้อง', 'cameraDistance', { min: 5, max: 25, step: 0.5, fmt: (v) => `${v.toFixed(1)} m` });
    this._slider(el, 'มุมกล้อง', 'cameraPitch', { min: 8, max: 70, step: 1, fmt: (v) => `${v}°` });
    el.appendChild(
      h(
        'div',
        'note',
        `<b>PC:</b> Bloop = WASD + Space · Glub = ลูกศร + Right Shift · ลากเมาส์หมุนกล้อง · ล้อเมาส์ซูม<br>
         P = หยุด · R = เกิดใหม่ · C = เปลี่ยนกล้อง · F3 = Debug<br>
         <b>มือถือ:</b> จอยซ้าย/ขวา + ปุ่ม JUMP · ลากพื้นที่ว่างเพื่อหมุนกล้อง · ใช้สองนิ้วซูม`,
      ),
    );
    const row = h('div', 'btn-row');
    const cam = h('button', 'btn', 'รีเซ็ตกล้อง');
    cam.addEventListener('click', () => this.game.cameraRig.reset());
    row.appendChild(cam);
    el.appendChild(row);
  }

  sync() {
    for (const fn of this.controls) fn();
    if (this.customNote) {
      const q = this.settings.get('quality');
      this.customNote.textContent = q === 'custom' ? 'กำลังใช้ค่าที่ปรับเอง (Custom)' : '';
      this.customNote.style.display = q === 'custom' ? '' : 'none';
    }
  }
}
