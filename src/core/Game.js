import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Settings } from '../settings/Settings.js';
import { AutoQuality } from '../settings/AutoQuality.js';
import { PARTICLE_BUDGET, REFLECTION_SCALE, SLIME_MAP_SIZE, QUALITY_LEVELS } from '../settings/presets.js';
import { RenderPipeline } from './RenderPipeline.js';
import { FixedLoop } from './FixedLoop.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { Environment } from '../scene/Environment.js';
import { Arena, ARENA_SIZE } from '../scene/Arena.js';
import { Slime } from '../characters/Slime.js';
import { CHARACTER_CONFIGS } from '../characters/configs.js';
import { PlanarReflection } from '../effects/PlanarReflection.js';
import { SlimeMap } from '../effects/SlimeMap.js';
import { SlimeDecals } from '../effects/SlimeDecals.js';
import { SplashSystem } from '../effects/SplashSystem.js';
import { ContactShadows } from '../effects/ContactShadows.js';
import { TrailSystem } from '../effects/TrailSystem.js';
import { InputManager } from '../controls/InputManager.js';
import { CameraRig } from '../camera/CameraRig.js';
import { PhysicsDebugger } from '../debug/PhysicsDebugger.js';
import { HUD } from '../ui/HUD.js';
import { shared, materialRegistry } from '../materials/SharedUniforms.js';
import { guessQualityTier } from '../utils/device.js';
import { clamp } from '../utils/math.js';

const PHYSICS_HZ = 60;
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Top-level orchestrator: owns every system, runs the fixed-timestep physics
 * with render interpolation, routes physics events to animation + effects,
 * and applies settings live.
 */
export class Game {
  constructor({ canvas, uiRoot }) {
    this.canvas = canvas;
    this.settings = new Settings(guessQualityTier());
    this.paused = false;
    this.simTime = 0;
    this.renderTime = 0;

    // --- rendering ---
    this.pipeline = new RenderPipeline(canvas);
    this.renderer = this.pipeline.renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
    this.camera.layers.enable(1);

    // --- world ---
    this.env = new Environment(this.scene);
    this.physics = new PhysicsWorld(this.settings);
    this.world = this.physics.world;
    this.arena = new Arena({ scene: this.scene, physics: this.physics, settings: this.settings, renderer: this.renderer });
    this.characters = [
      new Slime(CHARACTER_CONFIGS.a, { physics: this.physics, scene: this.scene, settings: this.settings }),
      new Slime(CHARACTER_CONFIGS.b, { physics: this.physics, scene: this.scene, settings: this.settings }),
    ];
    this.byId = { a: this.characters[0], b: this.characters[1] };

    // --- effects ---
    const A = CHARACTER_CONFIGS.a;
    const B = CHARACTER_CONFIGS.b;
    this.reflection = new PlanarReflection(this.renderer, 0);
    this.slimeMap = new SlimeMap(this.renderer, { size: ARENA_SIZE, resolution: SLIME_MAP_SIZE[this.settings.get('textureQuality')] || 1024 });
    this.decals = new SlimeDecals(this.scene, A.trail, B.trail);
    this.splash = new SplashSystem(this.scene, this.world, { slimeMap: this.slimeMap, decals: this.decals, colors: [A.trail, B.trail] });
    this.contactShadows = new ContactShadows(this.scene, this.world);
    this.trail = new TrailSystem({ slimeMap: this.slimeMap, decals: this.decals });
    const fu = this.arena.floorMaterial.uniforms;
    fu.uSlimeRect.value = this.slimeMap.rect;
    fu.uSlimeColorA.value.set(A.trail);
    fu.uSlimeColorB.value.set(B.trail);
    fu.uReflMatrix.value = this.reflection.textureMatrix;

    // --- control / camera / ui ---
    this.input = new InputManager(this.settings);
    this.cameraRig = new CameraRig(this.camera, canvas, this.settings);
    this.debugger = new PhysicsDebugger(this.scene, this.world);
    this.debugOn = false;
    this.hud = new HUD(this, uiRoot);
    this.autoQuality = new AutoQuality(this.settings, (m) => this.hud.toast(m, 2200));

    this._bindHotkeys();
    this._bindSettings();
    this.applyGraphics(true);
    this.applyPhysics();

    // --- sizing ---
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', () => setTimeout(this._onResize, 120));
    window.visualViewport?.addEventListener('resize', this._onResize);
    this.resize();

    // prevent page gestures / scrolling while playing
    for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', (e) => {
      if (!e.target.closest?.('.sheet-body')) e.preventDefault();
    }, { passive: false });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.loop.resetClock();
    });

    // --- context loss ---
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.loop.stop();
      this.hud.toast('กราฟิกขัดข้อง (WebGL context lost) — กำลังกู้คืน…', 5000);
    });
    canvas.addEventListener('webglcontextrestored', () => window.location.reload());

    this.cameraRig.snap(this.characters, this.settings.get('focus'));
    this.stats = { fps: 60, ms: 16, frames: 0, acc: 0 };
    this.loop = new FixedLoop({
      step: 1 / PHYSICS_HZ,
      maxSteps: 5,
      preUpdate: (dt) => this.input.update(dt),
      fixedUpdate: (h) => this.fixedStep(h),
      render: (dt, alpha) => this.frame(dt, alpha),
      isPaused: () => this.paused,
    });
  }

  start() {
    // warm up shader programs before the first visible frame
    this.renderer.compile(this.scene, this.camera);
    this.loop.start();
  }

  // ---------------------------------------------------------------------------
  // Settings
  _bindSettings() {
    const graphicsKeys = new Set(['graphics', 'shadowQuality', 'shadowResolution', 'reflectionQuality', 'ambientOcclusion', 'particleQuality', 'textureQuality', 'renderScale', 'antiAliasing']);
    const physicsKeys = new Set(['physics', 'gravity', 'bounce', 'friction', 'moveSpeed', 'slimeLifetime']);
    this.settings.on('change', (key) => {
      if (graphicsKeys.has(key)) this.applyGraphics();
      if (physicsKeys.has(key)) this.applyPhysics();
      if (key === 'controlMode' || key === 'focus') {
        if (key === 'focus' && this.settings.get('controlMode') === 'single' && this.settings.get('focus') !== 'both') {
          this.input.singleTarget = this.settings.get('focus');
          this.hud.refresh();
        }
      }
    });
  }

  applyGraphics(initial = false) {
    const s = this.settings;
    const q = s.get('quality');
    this.pipeline.configure({
      scene: this.scene,
      camera: this.camera,
      antiAliasing: s.get('antiAliasing'),
      ambientOcclusion: s.get('ambientOcclusion'),
      renderScale: s.get('renderScale'),
      quality: QUALITY_LEVELS.includes(q) ? q : 'high',
    });
    const sq = s.get('shadowQuality');
    const recompile = this.pipeline.setShadowType(sq);
    this.env.setShadowResolution(s.get('shadowResolution'));
    this.env.setShadowSoftness(sq === 'high' ? 3 : sq === 'medium' ? 1.5 : 1);
    this.env.setShadowExtent(sq === 'high' ? 26 : 22);

    // reflections
    const rq = s.get('reflectionQuality');
    this.reflection.setQuality(REFLECTION_SCALE[rq] || 0);
    const { w, h } = this.pipeline.bufferSize;
    this.reflection.setSize(w, h);
    const fm = this.arena.floorMaterial;
    const wantRefl = !!this.reflection.texture;
    if (('USE_REFLECTION' in fm.defines) !== wantRefl) {
      if (wantRefl) fm.defines.USE_REFLECTION = '';
      else delete fm.defines.USE_REFLECTION;
      fm.needsUpdate = true;
    }
    fm.uniforms.uReflection.value = this.reflection.texture || fm.uniforms.uSlimeMap.value;
    fm.uniforms.uReflStrength.value = rq === 'high' ? 1 : rq === 'medium' ? 0.9 : 0.75;

    // effects
    this.contactShadows.propAO = s.get('ambientOcclusion') !== 'off';
    this.splash.setBudget(PARTICLE_BUDGET[s.get('particleQuality')] || 120);
    const tq = s.get('textureQuality');
    this.slimeMap.setResolution(SLIME_MAP_SIZE[tq] || 1024);
    fm.uniforms.uSlimeMap.value = this.slimeMap.texture;
    if (!initial && tq !== this._lastTexQ) this.arena.setTextureQuality(tq);
    this._lastTexQ = tq;

    if (recompile) for (const m of materialRegistry) m.needsUpdate = true;
  }

  applyPhysics() {
    this.physics.applyTuning();
    this.decals.setLifetime(this.settings.get('slimeLifetime'));
  }

  // ---------------------------------------------------------------------------
  // Fixed-rate simulation
  fixedStep(h) {
    if (this.paused) return;
    const physics = this.physics;
    physics.savePrevious();
    this.arena.fixedUpdate(this.simTime, h);
    for (const c of this.characters) c.fixedUpdate(h, this.input.state[c.id], this.cameraRig.yaw);
    this.input.consumeJumps();
    this._applyLiquids(h);
    physics.step(h);
    this.simTime += h;

    for (const c of this.characters) {
      c.postStep(this.world);
      this._handleEvents(c);
      this.trail.step(c, c.id === 'a' ? 0 : 1, h, this.simTime);
      const p = c.body.position;
      if (p.y < -20 || Math.abs(p.x) > ARENA_SIZE || Math.abs(p.z) > ARENA_SIZE || !Number.isFinite(p.y)) {
        c.respawn();
        this.hud.toast(`${c.cfg.name} หลุดสนาม — เกิดใหม่แล้ว`);
      }
    }
  }

  _handleEvents(c) {
    const channel = c.id === 'a' ? 0 : 1;
    for (const e of c.events) {
      if (e.type === 'jump') {
        c.reactJump();
        if (c.grounded || c.groundBody) {
          this.splash.emit(c.groundPoint, c.groundNormal, 0.12, channel);
          if (c.groundBody?.userData?.isFloor) this.slimeMap.stamp(c.groundPoint.x, c.groundPoint.z, c.radius * 0.9, 1, channel);
        }
      } else if (e.type === 'launch') {
        c.reactJump();
        c.anim.squashVel += 4;
        this.splash.emit(c.groundPoint, _n.set(0, 1, 0), 0.6, channel);
      } else if (e.type === 'impact') {
        const other = e.other;
        const otherChar = other.userData?.isCharacter ? other.userData.character : null;
        c.reactImpact(e.speed, e.normal);
        if (other.userData?.spring) this.arena.triggerSpring(other);
        const intensity = clamp((e.speed - 2) / 11, 0.1, 1);
        if (otherChar) {
          if (c.id === 'a' && e.speed > 1.5) this.splash.emit(e.point, _n.copy(e.normal).negate().setY(Math.abs(e.normal.y) + 0.4).normalize(), Math.max(0.35, intensity), 2);
          continue;
        }
        if (e.speed > 2.6) {
          this.splash.emit(e.point, e.normal, intensity, channel);
          if (other.userData?.isFloor && e.normal.y > 0.6) {
            // landing splat: big puddle + ring of drops on the floor
            const r = c.radius * (0.9 + intensity * 0.9);
            this.slimeMap.stamp(e.point.x, e.point.z, r, 1, channel);
            const drops = 4 + Math.round(intensity * 6);
            for (let i = 0; i < drops; i++) {
              const a = (i / drops) * Math.PI * 2 + Math.random();
              const d = r * (1.1 + Math.random() * 0.9);
              this.slimeMap.stamp(e.point.x + Math.cos(a) * d, e.point.z + Math.sin(a) * d, r * (0.15 + Math.random() * 0.2), 0.9, channel);
            }
          } else if (other.type === CANNON.Body.STATIC && !other.userData?.isFloor) {
            this.decals.spawn(e.point, e.normal, c.radius * (1.4 + intensity), channel, this.simTime, 1);
          }
        }
      }
    }
    c.events.length = 0;
  }

  _applyLiquids(h) {
    const g = this.settings.get('gravity');
    for (const L of this.arena.liquids) {
      const apply = (body, radius, char) => {
        const p = body.position;
        if (p.x < L.minX || p.x > L.maxX || p.z < L.minZ || p.z > L.maxZ) {
          if (char) char.inLiquid = 0;
          return;
        }
        const depth = L.surfaceY - (p.y - radius);
        const f = clamp(depth / (radius * 2), 0, 1);
        if (char) {
          if (char.inLiquid === 0 && f > 0 && body.velocity.y < -2.5) {
            _v.set(p.x, L.surfaceY, p.z);
            this.splash.emit(_v, _n.set(0, 1, 0), clamp(-body.velocity.y / 10, 0.2, 1), char.id === 'a' ? 0 : 1);
            this._ripple(L, p.x, p.z, clamp(-body.velocity.y / 8, 0.3, 1));
          } else if (f > 0 && Math.hypot(body.velocity.x, body.velocity.z) > 1.5 && Math.random() < h * 3) {
            this._ripple(L, p.x, p.z, 0.35);
          }
          char.inLiquid = f;
        }
        if (f <= 0) return;
        if (body.sleepState === CANNON.Body.SLEEPING) body.wakeUp();
        const buoy = char ? 1.45 : 1.25;
        body.force.y += body.mass * g * f * buoy;
        const drag = 1 - Math.min(0.5, 2.8 * h * f);
        body.velocity.scale(drag, body.velocity);
        body.angularVelocity.scale(1 - Math.min(0.5, 2 * h * f), body.angularVelocity);
      };
      for (const c of this.characters) apply(c.body, c.radius, c);
      for (const rec of this.arena.dynamicBodies) {
        const b = rec.body;
        const s = b.userData.size;
        apply(b, s ? s[1] * 0.5 : 0.5, null);
      }
    }
  }

  _ripple(L, x, z, strength) {
    const arr = L.material.uniforms.uRipples.value;
    arr[L.rippleIndex].set(x, z, shared.uTime.value, strength);
    L.rippleIndex = (L.rippleIndex + 1) % arr.length;
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  frame(dt, alpha) {
    const animDt = this.paused ? 0 : dt;
    this.renderTime += animDt;
    shared.uTime.value = this.simTime + (this.paused ? 0 : alpha / PHYSICS_HZ);
    if (this.paused) this.input.consumeJumps();

    const time = shared.uTime.value;
    this.arena.update(animDt, alpha);
    const [a, b] = this.characters;
    a.update(animDt, alpha, time, this.camera, b);
    b.update(animDt, alpha, time, this.camera, a);
    this.splash.update(animDt, this.settings.get('gravity'), time);
    this.slimeMap.update(animDt, this.settings.get('slimeLifetime'));
    this.contactShadows.update(this.characters, this.arena.dynamicBodies, alpha);

    this.cameraRig.update(dt, this.characters, this.settings.get('focus'));
    this.env.update(this.cameraRig.target);
    this.scene.updateMatrixWorld();

    const info = this.renderer.info;
    info.reset();
    this.reflection.update(this.scene, this.camera);
    this.pipeline.render();
    this.debugger.update();

    // stats
    const st = this.stats;
    st.frames++;
    st.acc += dt;
    if (st.acc >= 0.5) {
      st.fps = st.frames / st.acc;
      st.ms = (st.acc / st.frames) * 1000;
      st.frames = 0;
      st.acc = 0;
    }
    this.autoQuality.sample(dt, !this.paused && !document.hidden);
    if (this.debugOn) this.hud.debugOverlay.update(dt, this._collectStats(info));
  }

  _collectStats(info) {
    if (!this._objCountT || performance.now() - this._objCountT > 1000) {
      let n = 0;
      this.scene.traverse((o) => {
        if (o.isMesh || o.isLine || o.isPoints) n += o.isInstancedMesh ? o.count : 1;
      });
      this._objCount = n;
      this._objCountT = performance.now();
    }
    let awake = 0;
    for (const b of this.world.bodies) if (b.type !== CANNON.Body.STATIC && b.sleepState !== CANNON.Body.SLEEPING) awake++;
    const { w, h } = this.pipeline.bufferSize;
    const ch = (c) => `${c.grounded ? 'ground' : 'air   '} v=${c.body.velocity.length().toFixed(1)} sq=${c.anim.squash.toFixed(2)}${c.groundBody?.userData?.surface ? ' ' + c.groundBody.userData.surface : ''}`;
    return {
      fps: this.stats.fps,
      ms: this.stats.ms,
      calls: info.render.calls,
      triangles: info.render.triangles,
      objects: this._objCount,
      bodies: this.world.bodies.length,
      awake,
      contacts: this.world.contacts.length,
      particles: this.splash.activeCount,
      particleBudget: this.splash.budget,
      decals: this.decals.activeCount,
      quality: this.settings.get('quality'),
      pixelRatio: this.pipeline.pixelRatio,
      buffer: `${w}×${h}`,
      a: ch(this.characters[0]),
      b: ch(this.characters[1]),
    };
  }

  // ---------------------------------------------------------------------------
  // Actions (UI)
  togglePause(force) {
    this.paused = typeof force === 'boolean' ? force : !this.paused;
    this.hud.setPaused(this.paused);
    this.loop.resetClock();
  }

  respawnCharacters() {
    for (const c of this.characters) c.respawn();
    this.trail.reset();
    this.hud.toast('เกิดใหม่แล้ว!');
  }

  resetArena() {
    this.arena.reset();
    this.slimeMap.clear();
    this.decals.clear();
    this.splash.clear();
    this.hud.toast('รีเซ็ตสนามทดลองแล้ว');
  }

  resetAll() {
    for (const c of this.characters) c.respawn();
    this.arena.reset();
    this.slimeMap.clear();
    this.decals.clear();
    this.splash.clear();
    this.trail.reset();
    this.cameraRig.reset();
    this.cameraRig.snap(this.characters, this.settings.get('focus'));
    if (this.paused) this.togglePause(false);
    this.hud.toast('รีเซ็ตทั้งหมดแล้ว');
  }

  cycleFocus() {
    const order = ['both', 'a', 'b'];
    const cur = this.settings.get('focus');
    const next = order[(order.indexOf(cur) + 1) % order.length];
    this.settings.set('focus', next);
    if (next !== 'both') this.input.singleTarget = next;
    this.hud.refresh();
    const label = next === 'both' ? 'กล้อง: ทั้งสองตัว (Auto Framing)' : `กล้อง: ${CHARACTER_CONFIGS[next].name}${this.settings.get('controlMode') === 'single' ? ' · ควบคุมตัวนี้' : ''}`;
    this.hud.toast(label);
  }

  swapSingleTarget() {
    this.input.singleTarget = this.input.singleTarget === 'a' ? 'b' : 'a';
    // release stick so the old character stops
    for (const id of ['a', 'b']) {
      this.input.state[id].x = 0;
      this.input.state[id].y = 0;
    }
    if (this.settings.get('focus') !== 'both') this.settings.set('focus', this.input.singleTarget);
    this.hud.refresh();
    this.hud.toast(`ควบคุม: ${CHARACTER_CONFIGS[this.input.singleTarget].name}`);
  }

  toggleDebug(force) {
    this.debugOn = typeof force === 'boolean' ? force : !this.debugOn;
    this.debugger.setEnabled(this.debugOn);
    this.hud.setDebug(this.debugOn);
  }

  _bindHotkeys() {
    const kb = this.input.keyboard;
    kb.onKey('KeyP', () => this.togglePause());
    kb.onKey('Escape', () => {
      if (this.hud.settingsPanel.isOpen) this.hud.settingsPanel.close();
      else this.togglePause();
    });
    kb.onKey('KeyR', () => this.respawnCharacters());
    kb.onKey('KeyC', () => this.cycleFocus());
    kb.onKey('F3', (e) => {
      e.preventDefault();
      this.toggleDebug();
    });
    kb.onKey('Backquote', () => this.toggleDebug());
    kb.onKey('KeyQ', () => this.cameraRig.rotate(0.35));
    kb.onKey('KeyE', () => this.cameraRig.rotate(-0.35));
  }

  // ---------------------------------------------------------------------------
  onLayoutChange() {
    if (this.pipeline) this.resize();
  }

  resize() {
    const vv = window.visualViewport;
    const w = Math.round(vv ? vv.width : window.innerWidth);
    const h = Math.round(vv ? vv.height : window.innerHeight);
    this.pipeline.setSize(w, h);
    this.cameraRig.setLayout(w, h, document.body.classList.contains('is-touch'));
    const buf = this.pipeline.bufferSize;
    this.reflection.setSize(buf.w, buf.h);
  }

  dispose() {
    this.loop.stop();
    window.removeEventListener('resize', this._onResize);
    for (const c of this.characters) c.dispose();
    this.arena.dispose();
    this.reflection.dispose();
    this.slimeMap.dispose();
    this.decals.dispose();
    this.splash.dispose();
    this.contactShadows.dispose();
    this.debugger.dispose();
    this.env.dispose();
    this.pipeline.dispose();
  }
}
