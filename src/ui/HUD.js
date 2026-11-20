import { ICONS } from './icons.js';
import { Joystick } from '../controls/Joystick.js';
import { TouchButton } from '../controls/TouchButton.js';
import { SettingsPanel } from './SettingsPanel.js';
import { DebugOverlay } from './DebugOverlay.js';
import { isTouchDevice } from '../utils/device.js';
import { CHARACTER_CONFIGS } from '../characters/configs.js';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};

/**
 * In-game HUD: toolbar (pause, reset, respawn, character select, arena reset,
 * debug, settings), touch controls (dual joysticks + jump buttons, single mode
 * with character swap), keyboard hints, toasts and the pause card.
 */
export class HUD {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.settings = game.settings;
    const A = CHARACTER_CONFIGS.a;
    const B = CHARACTER_CONFIGS.b;

    // ---------------- top bar ----------------
    const top = h('div', 'topbar');
    const brand = h('div', 'brand', `<span class="brand-dot"></span><span class="brand-text">Toon Physics <small>Playground</small></span>`);
    const bar = h('div', 'toolbar');
    const btn = (icon, tip, onClick) => {
      const b = h('button', 'icon-btn', ICONS[icon]);
      b.type = 'button';
      b.dataset.tip = tip;
      b.setAttribute('aria-label', tip);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
        b.blur();
      });
      bar.appendChild(b);
      return b;
    };
    this.pauseBtn = btn('pause', 'หยุด / เล่นต่อ (P)', () => game.togglePause());
    btn('reset', 'รีเซ็ตทั้งหมด', () => game.resetAll());
    btn('respawn', 'เกิดใหม่ (R)', () => game.respawnCharacters());
    this.focusBtn = btn('chars', 'เลือกตัวละคร / กล้อง (C)', () => game.cycleFocus());
    this.focusBadge = h('span', 'badge both', 'AB');
    this.focusBtn.appendChild(this.focusBadge);
    btn('arena', 'รีเซ็ตสนามทดลอง', () => game.resetArena());
    this.debugBtn = btn('debug', 'Physics Debug (F3)', () => game.toggleDebug());
    btn('settings', 'ตั้งค่า', () => this.settingsPanel.open());
    top.append(brand, bar);

    // ---------------- touch controls ----------------
    const touch = h('div', 'touch-controls');
    const zl = h('div', 'joy-zone left');
    const zr = h('div', 'joy-zone right');
    this.jumpA = h('button', 'jump-btn a', 'JUMP');
    this.jumpB = h('button', 'jump-btn b', 'JUMP');
    const dock = h('div', 'ctrl-dock');
    this.modeBtn = h('button', 'pill-btn', '');
    this.modeBtn.addEventListener('click', () => {
      this.settings.set('controlMode', this.settings.get('controlMode') === 'dual' ? 'single' : 'dual');
    });
    this.swapBtn = h('button', 'pill-btn swap-btn', '');
    this.swapBtn.addEventListener('click', () => game.swapSingleTarget());
    dock.append(this.modeBtn, this.swapBtn);
    touch.append(zl, zr, this.jumpA, this.jumpB, dock);
    this.touchEl = touch;

    // ---------------- keyboard hints ----------------
    const kbd = h(
      'div',
      'kbd-hint',
      `<div class="chip"><span class="pill-dot" style="color:${A.color}">●</span> A <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> + <kbd>Space</kbd></div>
       <div class="chip"><span style="color:${B.color}">●</span> B <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> + <kbd>R-Shift</kbd></div>
       <div class="chip">ลากเมาส์ = หมุนกล้อง · ล้อ = ซูม</div>`,
    );
    this.kbdEl = kbd;

    // ---------------- toast + pause ----------------
    this.toastEl = h('div', 'toast');
    this.pauseOverlay = h('div', 'overlay center');
    const card = h(
      'div',
      'card',
      `<div style="font-size:42px">🫧</div><h2>หยุดชั่วคราว</h2><p>สนามทดลองฟิสิกส์หยุดอยู่ กล้องยังหมุนได้</p>`,
    );
    const row = h('div', 'btn-row');
    const resume = h('button', 'btn primary', 'เล่นต่อ');
    resume.addEventListener('click', () => game.togglePause(false));
    const respawn = h('button', 'btn', 'เกิดใหม่');
    respawn.addEventListener('click', () => {
      game.respawnCharacters();
      game.togglePause(false);
    });
    const resetArena = h('button', 'btn', 'รีเซ็ตสนาม');
    resetArena.addEventListener('click', () => {
      game.resetArena();
      game.togglePause(false);
    });
    row.append(resume, respawn, resetArena);
    card.appendChild(row);
    this.pauseOverlay.appendChild(card);
    this.pauseOverlay.addEventListener('click', (e) => {
      if (e.target === this.pauseOverlay) game.togglePause(false);
    });

    root.append(top, touch, kbd, this.toastEl, this.pauseOverlay);

    // joysticks / jump buttons (after being in the DOM so sizes are known)
    this.joyLeft = new Joystick(zl, { color: A.color, label: A.name });
    this.joyRight = new Joystick(zr, { color: B.color, label: B.name });
    this.jumpBtnA = new TouchButton(this.jumpA);
    this.jumpBtnB = new TouchButton(this.jumpB);
    game.input.attachTouch({ joyLeft: this.joyLeft, joyRight: this.joyRight, jumpA: this.jumpBtnA, jumpB: this.jumpBtnB });

    this.settingsPanel = new SettingsPanel(game, root);
    this.debugOverlay = new DebugOverlay(root);

    // ---------------- input-mode detection ----------------
    this.setTouchMode(isTouchDevice());
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') this.setTouchMode(true);
      },
      { capture: true, passive: true },
    );
    window.addEventListener('keydown', (e) => {
      if (/^(Key[WASD]|Arrow|Space|ShiftRight)/.test(e.code)) this.setTouchMode(false);
    });

    this.settings.on('change', (k) => {
      if (k === 'controlMode' || k === 'focus') this.refresh();
    });
    this.refresh();
  }

  setTouchMode(on) {
    if (this.touchMode === on) return;
    this.touchMode = on;
    document.body.classList.toggle('is-touch', on);
    requestAnimationFrame(() => {
      this.joyLeft?.release();
      this.joyRight?.release();
    });
    this.game.onLayoutChange();
  }

  refresh() {
    const s = this.settings;
    const single = s.get('controlMode') === 'single';
    document.body.classList.toggle('ctrl-single', single);
    const A = CHARACTER_CONFIGS.a;
    const B = CHARACTER_CONFIGS.b;
    this.modeBtn.innerHTML = single ? '👤 ควบคุม 1 ตัว' : '👥 ควบคุม 2 ตัว';
    const t = this.game.input.singleTarget;
    const cfg = t === 'a' ? A : B;
    this.swapBtn.innerHTML = `<span class="swatch" style="background:${cfg.color}"></span>${cfg.name} ⇄`;
    if (single) {
      this.joyLeft.setLabel(cfg.name, cfg.color);
      this.jumpB.style.setProperty('--joy-color', cfg.color);
    } else {
      this.joyLeft.setLabel(A.name, A.color);
      this.joyRight.setLabel(B.name, B.color);
      this.jumpB.style.removeProperty('--joy-color');
    }
    const f = s.get('focus');
    this.focusBadge.className = `badge ${f === 'both' ? 'both' : f}`;
    this.focusBadge.textContent = f === 'both' ? 'AB' : f.toUpperCase();
  }

  setPaused(p) {
    this.pauseBtn.innerHTML = p ? ICONS.play : ICONS.pause;
    this.pauseBtn.classList.toggle('active', p);
    this.pauseOverlay.classList.toggle('open', p);
  }

  setDebug(on) {
    this.debugBtn.classList.toggle('active', on);
    this.debugOverlay.setVisible(on);
  }

  toast(msg, ms = 1600) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
}
