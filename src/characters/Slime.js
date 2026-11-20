import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GROUP, PhysicsWorld, interpolateBody } from '../physics/PhysicsWorld.js';
import { createSlimeMaterial, createOutlineMaterial, createEyeMaterial } from '../materials/SurfaceMaterials.js';
import { clamp, damp, dampAngle, rand } from '../utils/math.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qLean = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _rot = new THREE.Matrix4();
const _cv = new CANNON.Vec3();

const mag2 = (v) => v.x * v.x + v.z * v.z;

let sharedBodyGeo = null;
let sharedEyeGeo = null;

/**
 * A slime character: one cannon-es sphere collider (never deformed) plus a
 * purely visual jelly mesh that squashes, stretches, leans, wobbles, blinks
 * and looks around based on velocities and impacts from the physics engine.
 */
export class Slime {
  constructor(cfg, { physics, scene, settings }) {
    this.cfg = cfg;
    this.id = cfg.id;
    this.physics = physics;
    this.settings = settings;
    this.radius = cfg.radius;

    // ---------------- physics ----------------
    const body = new CANNON.Body({
      mass: cfg.mass,
      material: physics.mat.slime,
      linearDamping: 0.04,
      angularDamping: 0.45,
      collisionFilterGroup: GROUP.CHARACTER,
      collisionFilterMask: GROUP.ALL,
    });
    body.addShape(new CANNON.Sphere(cfg.radius));
    body.allowSleep = false;
    body.position.set(...cfg.spawn);
    body.userData = { isCharacter: true, character: this };
    physics.add(body, { track: true });
    this.body = body;

    this.impacts = [];
    body.addEventListener('collide', (e) => this._onCollide(e));

    // controller state
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundBody = null;
    this.groundPoint = new THREE.Vector3();
    this.lastGroundTime = -10;
    this.jumpBuffer = 0;
    this.jumpCooldown = 0;
    this.jumping = false;
    this.pendingLaunch = 0;
    this.stepUp = 0;
    this.moveDir = new THREE.Vector3();
    this.inLiquid = 0;
    this.simTime = 0;
    this.events = []; // {type:'jump'|'land'|'impact'|'launch', ...} consumed by the game

    // ---------------- visuals ----------------
    if (!sharedBodyGeo) {
      sharedBodyGeo = new THREE.SphereGeometry(1, 56, 40);
      sharedBodyGeo.userData.shared = true;
      sharedEyeGeo = new THREE.SphereGeometry(1, 28, 20);
      sharedEyeGeo.userData.shared = true;
    }
    this.material = createSlimeMaterial({ color: cfg.color, deep: cfg.deep, glow: cfg.glow, rim: cfg.rim, seed: cfg.id === 'a' ? 0 : 17.3 });
    this.material.uniforms.uWobbleSpeed.value = cfg.wobbleSpeed;
    this.mesh = new THREE.Mesh(sharedBodyGeo, this.material);
    this.mesh.name = `Slime-${cfg.name}`;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;

    this.outline = new THREE.Mesh(sharedBodyGeo, createOutlineMaterial(this.material, cfg.outline, 0.045));
    this.outline.matrixAutoUpdate = true;
    this.outline.frustumCulled = false;

    // the mesh matrix already contains the radius, so the face lives in unit-sphere space
    this.face = new THREE.Group();
    this.mesh.add(this.outline);
    this.mesh.add(this.face);

    this.eyeMaterial = createEyeMaterial(cfg.color);
    this.eyeMaterial.uniforms.uPupilSize.value = cfg.pupil;
    this.eyes = [];
    for (const side of [-1, 1]) {
      const dir = new THREE.Vector3(side * 0.34, 0.24, 0.91).normalize();
      const eye = new THREE.Mesh(sharedEyeGeo, this.eyeMaterial);
      eye.position.copy(dir).multiplyScalar(0.9);
      eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      eye.scale.set(0.24, 0.3, 0.17);
      eye.receiveShadow = true;
      eye.frustumCulled = false;
      this.face.add(eye);
      this.eyes.push(eye);
    }
    scene.add(this.mesh);

    this.anim = {
      pos: new THREE.Vector3().copy(body.position),
      vel: new THREE.Vector3(),
      accel: new THREE.Vector3(),
      yaw: 0,
      lean: new THREE.Vector3(),
      squash: 1,
      squashVel: 0,
      axis: new THREE.Vector3(0, 1, 0),
      pivot: 1,
      wobble: 0,
      wobbleDir: new THREE.Vector3(0, -1, 0),
      hopPhase: 0,
      look: new THREE.Vector2(),
      lookTarget: new THREE.Vector3(),
      lookTimer: 0,
      lookMode: 'camera',
      blinkTimer: rand(cfg.blinkMin, cfg.blinkMax),
      blinkT: -1,
      blinkDouble: false,
      squeeze: 0,
      mouth: 0,
      idleTime: 0,
      airTime: 0,
    };
  }

  get position() {
    return this.anim.pos;
  }

  // ---------------------------------------------------------------------------
  _onCollide(e) {
    const c = e.contact;
    const speed = Math.abs(c.getImpactVelocityAlongNormal());
    if (speed < 1.2) return;
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    if (c.bi === this.body) {
      n.set(-c.ni.x, -c.ni.y, -c.ni.z);
      p.set(c.bi.position.x + c.ri.x, c.bi.position.y + c.ri.y, c.bi.position.z + c.ri.z);
    } else {
      n.set(c.ni.x, c.ni.y, c.ni.z);
      p.set(c.bj.position.x + c.rj.x, c.bj.position.y + c.rj.y, c.bj.position.z + c.rj.z);
    }
    if (this.impacts.length < 8) this.impacts.push({ speed, normal: n, point: p, other: e.body });
    const spring = e.body.userData?.spring;
    if (spring) this.pendingLaunch = Math.max(this.pendingLaunch, spring);
  }

  /** Physics-rate control. input: {x, y, jumpPressed, jumpHeld}. */
  fixedUpdate(h, input, camYaw) {
    const b = this.body;
    const cfg = this.cfg;
    const s = this.settings;
    const speedMul = s.get('moveSpeed');
    const g = s.get('gravity');
    this.simTime += h;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - h);
    if (this.grounded) this.lastGroundTime = this.simTime;

    // --- surface modifiers ---
    const surface = this.grounded ? this.groundBody?.userData?.surface : null;
    let traction = 1;
    let speedCap = cfg.maxSpeed * speedMul;
    let brake = cfg.brake;
    if (surface === 'ice') {
      traction = 0.1;
      brake = 0.02;
    } else if (surface === 'sticky') {
      traction = 1.4;
      speedCap *= 0.4;
      brake = 1.2;
    }
    if (this.inLiquid > 0.1) speedCap *= 0.55;

    // --- camera-relative input ---
    const ix = input.x;
    const iy = input.y;
    const mag = Math.min(1, Math.hypot(ix, iy));
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    // forward (away from camera) = (-sin, -cos); right = (cos, -sin)
    const dx = cos * ix - sin * iy;
    const dz = -sin * ix - cos * iy;
    this.moveDir.set(dx, 0, dz);

    // platform carry velocity
    let gvx = 0;
    let gvz = 0;
    let gvy = 0;
    const gb = this.groundBody;
    if (this.grounded && gb && gb.type === CANNON.Body.KINEMATIC) {
      _cv.set(this.groundPoint.x - gb.position.x, this.groundPoint.y - gb.position.y, this.groundPoint.z - gb.position.z);
      const w = gb.angularVelocity;
      gvx = gb.velocity.x + (w.y * _cv.z - w.z * _cv.y);
      gvy = gb.velocity.y;
      gvz = gb.velocity.z + (w.x * _cv.y - w.y * _cv.x);
    }

    const tvx = dx * speedCap + gvx;
    const tvz = dz * speedCap + gvz;
    const vx = b.velocity.x;
    const vz = b.velocity.z;
    let dvx = tvx - vx;
    let dvz = tvz - vz;
    let accel;
    if (this.grounded) accel = cfg.accel * speedMul * traction * (mag > 0.05 ? 1 : brake);
    else if (this.inLiquid > 0.1) accel = cfg.airAccel * 0.8 * speedMul;
    else {
      accel = cfg.airAccel * speedMul;
      if (mag < 0.05) accel = 0; // keep momentum in the air
      // don't brake air speed above the cap when steering
      const along = dvx * dx + dvz * dz;
      if (mag > 0.05 && along < 0) {
        dvx -= dx * along;
        dvz -= dz * along;
      }
    }
    const dvLen = Math.hypot(dvx, dvz);
    const maxDv = accel * h;
    if (dvLen > maxDv && dvLen > 0) {
      dvx *= maxDv / dvLen;
      dvz *= maxDv / dvLen;
    }
    b.velocity.x += dvx;
    b.velocity.z += dvz;

    // rolling: align spin with travel so friction doesn't fight the control
    if (this.grounded && surface !== 'ice') {
      const r = this.radius;
      const k = 0.35;
      const rvx = b.velocity.x - gvx;
      const rvz = b.velocity.z - gvz;
      b.angularVelocity.x += (rvz / r - b.angularVelocity.x) * k;
      b.angularVelocity.z += (-rvx / r - b.angularVelocity.z) * k;
      b.angularVelocity.y *= 0.9;
    }

    // --- jump ---
    if (input.jumpPressed) this.jumpBuffer = 0.14;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - h);
    const canJump = this.simTime - this.lastGroundTime < 0.12 || this.inLiquid > 0.3;
    if (this.jumpBuffer > 0 && canJump && this.jumpCooldown <= 0) {
      let j = cfg.jump * Math.sqrt(g / 18) * (0.85 + 0.15 * speedMul);
      if (surface === 'sticky') j *= 0.7;
      if (this.inLiquid > 0.3) j *= 0.9;
      // jump mostly up, slightly along the ground normal on slopes
      const n = this.grounded ? this.groundNormal : UP;
      b.velocity.x += n.x * j * 0.25;
      b.velocity.z += n.z * j * 0.25;
      b.velocity.y = Math.max(gvy, 0) + j;
      this.jumpBuffer = 0;
      this.jumpCooldown = 0.2;
      this.lastGroundTime = -10;
      this.jumping = true;
      this.grounded = false;
      this.events.push({ type: 'jump' });
    }
    // variable jump height: release early = shorter hop
    if (this.jumping) {
      if (b.velocity.y <= 0) this.jumping = false;
      else if (!input.jumpHeld) b.velocity.y -= g * 1.1 * h;
    }

    // --- step assist: a little hop over low ledges we're pushing into ---
    if (this.stepUp > 0) {
      if (b.velocity.y < 1.5 && !this.jumping) {
        b.velocity.y = Math.sqrt(2 * g * (this.stepUp + 0.12));
        this.anim.squashVel += 2.5;
      }
      this.stepUp = 0;
    }

    // --- spring pad launch ---
    if (this.pendingLaunch > 0) {
      b.velocity.y = this.pendingLaunch * Math.sqrt(g / 18);
      this.events.push({ type: 'launch' });
      this.pendingLaunch = 0;
      this.jumping = false;
      this.lastGroundTime = -10;
    }

    // safety clamp
    const sp = b.velocity.length();
    if (sp > 40) b.velocity.scale(40 / sp, b.velocity);
  }

  /** After world.step: detect ground from the solver's contact list and process impacts. */
  postStep(world) {
    const b = this.body;
    let best = 0.5;
    let wasGrounded = this.grounded;
    this.grounded = false;
    this.groundBody = null;
    const contacts = world.contacts;
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      let nx, ny, nz, other;
      if (c.bi === b) {
        nx = -c.ni.x; ny = -c.ni.y; nz = -c.ni.z; other = c.bj;
      } else if (c.bj === b) {
        nx = c.ni.x; ny = c.ni.y; nz = c.ni.z; other = c.bi;
      } else continue;
      // low ledge in front of us while steering into it? (step assist)
      if (ny < 0.75 && ny > -0.2 && mag2(this.moveDir) > 0.09) {
        const cpY = c.bi === b ? b.position.y + c.ri.y : b.position.y + c.rj.y;
        const hp = cpY - (b.position.y - this.radius);
        const hl = Math.hypot(nx, nz) || 1;
        const facing = -(nx * this.moveDir.x + nz * this.moveDir.z) / hl / Math.sqrt(mag2(this.moveDir));
        if (hp > 0.06 && hp < 0.42 && facing > 0.5 && other.type === CANNON.Body.STATIC && this.simTime - this.lastGroundTime < 0.1) this.stepUp = Math.max(this.stepUp, hp);
      }
      if (ny > best) {
        best = ny;
        this.grounded = true;
        this.groundNormal.set(nx, ny, nz);
        this.groundBody = other;
      }
    }
    if (this.grounded) {
      this.groundPoint.set(b.position.x, b.position.y, b.position.z).addScaledVector(this.groundNormal, -this.radius);
      if (!wasGrounded && this.anim.airTime > 0.25) this.events.push({ type: 'land' });
    }
    for (const imp of this.impacts) this.events.push({ type: 'impact', ...imp });
    this.impacts.length = 0;
  }

  respawn() {
    const b = this.body;
    b.position.set(...this.cfg.spawn);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.quaternion.set(0, 0, 0, 1);
    PhysicsWorld.snap(b);
    this.pendingLaunch = 0;
    this.jumping = false;
    this.impacts.length = 0;
    this.events.length = 0;
    const a = this.anim;
    a.squash = 0.7;
    a.squashVel = 6;
    a.axis.set(0, 1, 0);
    a.wobble = 0.8;
    a.yaw = 0;
    a.lean.set(0, 0, 0);
    a.pos.copy(b.position);
  }

  /** Apply visual reaction to an impact (called by the game when processing events). */
  reactImpact(speed, normal) {
    const a = this.anim;
    const k = this.cfg.impactSquash;
    a.squashVel -= Math.min(speed * 0.6, 8) * k;
    a.axis.copy(normal);
    a.pivot = 1;
    a.wobble = Math.min(1.2, a.wobble + speed * 0.09 * k);
    // wobble direction in the mesh's local frame (towards the contact side)
    _qYaw.setFromAxisAngle(UP, -a.yaw);
    a.wobbleDir.copy(normal).negate().applyQuaternion(_qYaw);
    if (speed > 7) a.squeeze = 0.22;
    if (speed > 5) a.mouth = Math.max(a.mouth, 0.8);
  }

  reactJump() {
    this.anim.squashVel += 5.5;
    this.anim.axis.set(0, 1, 0);
    this.anim.wobble = Math.min(1, this.anim.wobble + 0.25);
  }

  // ---------------------------------------------------------------------------
  /** Render-rate animation. */
  update(dt, alpha, time, camera, other) {
    const a = this.anim;
    const cfg = this.cfg;
    const b = this.body;
    interpolateBody(b, alpha, a.pos);

    // smoothed velocity / acceleration
    _v.set(b.velocity.x, b.velocity.y, b.velocity.z);
    _v2.copy(_v).sub(a.vel).divideScalar(Math.max(dt, 1e-3));
    a.accel.lerp(_v2, damp(6, dt));
    a.vel.lerp(_v, damp(20, dt));
    const hs = Math.hypot(a.vel.x, a.vel.z);
    const grounded = this.simTime - this.lastGroundTime < 0.08;
    a.airTime = grounded ? 0 : a.airTime + dt;

    // facing direction
    if (hs > 0.35) a.yaw = dampAngle(a.yaw, Math.atan2(a.vel.x, a.vel.z), cfg.turnRate, dt);
    a.idleTime = hs < 0.3 && grounded ? a.idleTime + dt : 0;
    // after idling a moment, shuffle round to face the camera (cute "looking at you")
    if (a.idleTime > 1.2) {
      const toCam = Math.atan2(camera.position.x - a.pos.x, camera.position.z - a.pos.z);
      a.yaw = dampAngle(a.yaw, toCam, cfg.turnRate * 0.18, dt);
    }

    // lean into acceleration + velocity
    const lx = clamp(a.accel.x * 0.02 + a.vel.x * 0.025, -0.4, 0.4);
    const lz = clamp(a.accel.z * 0.02 + a.vel.z * 0.025, -0.4, 0.4);
    a.lean.x += (lx - a.lean.x) * damp(8, dt);
    a.lean.z += (lz - a.lean.z) * damp(8, dt);

    // squash & stretch spring
    let target;
    _v2.set(0, 1, 0);
    if (grounded) {
      if (hs < 0.5) target = 1 + Math.sin(time * cfg.idleFreq) * cfg.idleAmp;
      else {
        a.hopPhase += hs * dt * 2.2;
        target = 1 + Math.sin(a.hopPhase * Math.PI) * cfg.hopAmp - Math.min(hs * 0.006, 0.05);
      }
      _v2.copy(this.groundNormal);
      a.pivot += (1 - a.pivot) * damp(12, dt);
    } else {
      const sp = a.vel.length();
      target = 1 + clamp(sp * 0.017, 0, 0.24);
      if (sp > 2) _v2.copy(a.vel).normalize();
      a.pivot += (0 - a.pivot) * damp(8, dt);
    }
    a.axis.lerp(_v2, damp(grounded ? 10 : 6, dt)).normalize();
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const acc = -cfg.squashK * (a.squash - target) - cfg.squashDamp * a.squashVel;
      a.squashVel += acc * sdt;
      a.squash += a.squashVel * sdt;
    }
    if (a.squash < 0.55) {
      a.squash = 0.55;
      a.squashVel = Math.max(a.squashVel, 0);
    } else if (a.squash > 1.5) {
      a.squash = 1.5;
      a.squashVel = Math.min(a.squashVel, 0);
    }

    // jelly wobble amplitude
    a.wobble *= Math.exp(-2.6 * dt);
    const wob = a.wobble + 0.08 + Math.min(hs * 0.025, 0.2);
    this.material.uniforms.uWobble.value = wob;
    this.material.uniforms.uWobbleDir.value.lerp(a.wobbleDir, damp(4, dt));
    a.wobbleDir.lerp(_v.set(0, -1, 0), damp(1.5, dt));

    // ---- compose the visual matrix: M = T(pos + p - S·p) · S · Rlean · Ryaw · scale(r)
    _qYaw.setFromAxisAngle(UP, a.yaw);
    const leanAmt = Math.hypot(a.lean.x, a.lean.z);
    if (leanAmt > 1e-4) {
      _v.set(a.lean.z, 0, -a.lean.x).divideScalar(leanAmt);
      _qLean.setFromAxisAngle(_v, leanAmt);
    } else _qLean.identity();
    _q.multiplyQuaternions(_qLean, _qYaw);
    _rot.makeRotationFromQuaternion(_q);
    _rot.scale(_v.set(this.radius, this.radius, this.radius));

    const s = a.squash;
    const qs = 1 / Math.sqrt(s);
    const ax = a.axis;
    const d = s - qs;
    // S = qs·I + (s - qs)·a·aᵀ
    _m.set(
      qs + d * ax.x * ax.x, d * ax.x * ax.y, d * ax.x * ax.z, 0,
      d * ax.y * ax.x, qs + d * ax.y * ax.y, d * ax.y * ax.z, 0,
      d * ax.z * ax.x, d * ax.z * ax.y, qs + d * ax.z * ax.z, 0,
      0, 0, 0, 1,
    );
    // pivot at the contact side so squashing keeps the slime on the ground
    const pr = -this.radius * a.pivot;
    const px = ax.x * pr;
    const py = ax.y * pr;
    const pz = ax.z * pr;
    const e = _m.elements;
    const spx = e[0] * px + e[4] * py + e[8] * pz;
    const spy = e[1] * px + e[5] * py + e[9] * pz;
    const spz = e[2] * px + e[6] * py + e[10] * pz;
    _m.multiply(_rot);
    _m.elements[12] = a.pos.x + px - spx;
    _m.elements[13] = a.pos.y + py - spy;
    _m.elements[14] = a.pos.z + pz - spz;
    this.mesh.matrix.copy(_m);
    this.mesh.matrixWorldNeedsUpdate = true;

    this._updateFace(dt, time, camera, other, hs, grounded);
  }

  _updateFace(dt, time, camera, other, hs, grounded) {
    const a = this.anim;
    const cfg = this.cfg;
    const eu = this.eyeMaterial.uniforms;

    // ---- where to look ----
    a.lookTimer -= dt;
    if (hs > 1.2 || !grounded) {
      a.lookTarget.copy(a.pos).addScaledVector(a.vel, 0.6);
      a.lookTarget.y += a.vel.y * 0.12;
      a.lookMode = 'move';
    } else {
      if (a.lookTimer <= 0 || a.lookMode === 'move') {
        const r = Math.random();
        const otherDist = other ? other.position.distanceTo(a.pos) : 99;
        if (otherDist < 10 && r < 0.45) a.lookMode = 'other';
        else if (r < 0.45 + cfg.curiosity * 0.4) a.lookMode = 'around';
        else a.lookMode = 'camera';
        a.lookTimer = rand(0.8, 2.6) / (0.5 + cfg.curiosity);
        a.aroundAngle = rand(-1.2, 1.2);
        a.aroundUp = rand(-0.3, 0.5);
      }
      if (a.lookMode === 'other' && other) a.lookTarget.copy(other.position);
      else if (a.lookMode === 'camera') a.lookTarget.copy(camera.position);
      else {
        const ang = a.yaw + a.aroundAngle;
        a.lookTarget.set(a.pos.x + Math.sin(ang) * 4, a.pos.y + a.aroundUp * 4, a.pos.z + Math.cos(ang) * 4);
      }
    }
    _v.copy(a.lookTarget).sub(a.pos);
    _qYaw.setFromAxisAngle(UP, -a.yaw);
    _v.applyQuaternion(_qYaw);
    const fz = Math.max(_v.z, 0.35 * Math.hypot(_v.x, _v.y, _v.z) + 0.01);
    let lx = clamp(_v.x / fz, -1, 1);
    let ly = clamp(_v.y / fz, -0.8, 0.8);
    // tiny saccades
    lx += Math.sin(time * 13.1 + cfg.lookSpeed) * 0.02;
    ly += Math.sin(time * 11.7) * 0.015;
    a.look.x += (lx - a.look.x) * damp(cfg.lookSpeed, dt);
    a.look.y += (ly - a.look.y) * damp(cfg.lookSpeed, dt);
    eu.uLook.value.copy(a.look);

    // ---- blinking ----
    a.blinkTimer -= dt;
    let blink = 0;
    if (a.blinkT >= 0) {
      a.blinkT += dt;
      const dur = 0.15;
      if (a.blinkT < dur) blink = Math.sin((a.blinkT / dur) * Math.PI);
      else if (a.blinkDouble && a.blinkT < dur * 2.3) blink = a.blinkT > dur * 1.3 ? Math.sin(((a.blinkT - dur * 1.3) / dur) * Math.PI) : 0;
      else a.blinkT = -1;
    } else if (a.blinkTimer <= 0) {
      a.blinkT = 0;
      a.blinkDouble = Math.random() < 0.25;
      a.blinkTimer = rand(cfg.blinkMin, cfg.blinkMax);
    }
    if (a.squeeze > 0) {
      a.squeeze -= dt;
      blink = 1;
    }
    // sleepy companion: droopy eyelids after idling
    const droop = cfg.sleepy ? clamp((a.idleTime - 4) * 0.15, 0, 0.32) : 0;
    eu.uBlink.value = Math.max(blink, droop);

    // ---- mouth ----
    let mouthTarget = 0;
    if (!grounded && a.vel.y < -6) mouthTarget = 1;
    a.mouth += (mouthTarget - a.mouth) * damp(mouthTarget > a.mouth ? 10 : 4, dt);
    this.material.uniforms.uMouthOpen.value = a.mouth > 0.06 ? a.mouth : 0;
  }

  dispose() {
    this.physics.remove(this.body);
    this.mesh.removeFromParent();
    this.material.dispose();
    this.outline.material.dispose();
    this.eyeMaterial.dispose();
  }
}
