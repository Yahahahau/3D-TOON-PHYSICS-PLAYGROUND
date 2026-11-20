import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createToonMaterial } from '../materials/ToonMaterial.js';
import { GROUP } from '../physics/PhysicsWorld.js';
import { rand } from '../utils/math.js';

const MAX = 360;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _from = new CANNON.Vec3();
const _to = new CANNON.Vec3();
const _ray = new CANNON.RaycastResult();

/**
 * Slime splash particles: pooled droplets (big and small) rendered with one
 * InstancedMesh. Droplets stretch along their velocity, shrink smoothly as
 * they die, and leave small slime marks where they land.
 */
export class SplashSystem {
  constructor(scene, world, { slimeMap, decals, colors }) {
    this.world = world;
    this.slimeMap = slimeMap;
    this.decals = decals;
    this.colors = colors.map((c) => new THREE.Color(c));
    this.budget = 120;
    this.material = createToonMaterial({ specular: 1, gloss: 36, rim: 0.7, rimColor: '#e6fbff', emissive: 0.12, name: 'SplashDroplet' });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.material, MAX);
    this.mesh.name = 'Splash';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.colors[0]);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    // pool (no allocations after construction)
    this.pool = [];
    for (let i = 0; i < MAX; i++) {
      this.pool.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0, life: 0, max: 1, color: new THREE.Color(), stamp: true, channel: 0 });
    }
    this.active = 0; // active particles are pool[0..active)
    this.time = 0;
  }

  setBudget(n) {
    this.budget = Math.min(MAX, n);
    if (this.active > this.budget) this.active = this.budget;
  }

  get activeCount() {
    return this.active;
  }

  /**
   * point/normal: impact location; intensity 0..1; channel: 0 = A, 1 = B, 2 = mixed
   */
  emit(point, normal, intensity, channel = 0) {
    const scale = this.budget / 220;
    const big = Math.round((2 + intensity * 5) * Math.min(1, scale + 0.3));
    const small = Math.round((5 + intensity * 18) * scale);
    // tangent frame around the normal
    _t1.set(1, 0, 0);
    if (Math.abs(normal.x) > 0.8) _t1.set(0, 0, 1);
    _t1.cross(normal).normalize();
    _t2.crossVectors(normal, _t1);
    const total = big + small;
    for (let i = 0; i < total; i++) {
      if (this.active >= this.budget) break;
      const p = this.pool[this.active++];
      const isBig = i < big;
      const a = Math.random() * Math.PI * 2;
      const spread = rand(0.35, 1.1);
      const up = rand(0.5, 1.2);
      const speed = (isBig ? rand(1.8, 3.8) : rand(2.5, 6.5)) * (0.55 + intensity * 0.9);
      _d.copy(normal).multiplyScalar(up).addScaledVector(_t1, Math.cos(a) * spread).addScaledVector(_t2, Math.sin(a) * spread).normalize();
      p.vel.copy(_d).multiplyScalar(speed);
      p.pos.copy(point).addScaledVector(normal, 0.08).addScaledVector(_d, 0.1);
      p.size = isBig ? rand(0.07, 0.13) : rand(0.025, 0.06);
      p.max = p.life = isBig ? rand(0.8, 1.4) : rand(0.45, 1.0);
      p.channel = channel === 2 ? (Math.random() < 0.5 ? 0 : 1) : channel;
      p.color.copy(this.colors[p.channel]).offsetHSL(0, 0, rand(-0.03, 0.12));
      p.stamp = isBig || Math.random() < 0.4;
    }
  }

  update(dt, gravity, time) {
    this.time = time;
    let i = 0;
    while (i < this.active) {
      const p = this.pool[i];
      p.life -= dt;
      p.vel.y -= gravity * dt;
      p.vel.multiplyScalar(1 - 0.6 * dt);
      p.pos.addScaledVector(p.vel, dt);
      let dead = p.life <= 0;
      if (!dead && p.vel.y < 0 && p.pos.y < 6) {
        // landing test: cheap floor check, ray test for raised surfaces
        if (p.pos.y - p.size <= 0.01) {
          if (p.stamp) this.slimeMap.stamp(p.pos.x, p.pos.z, p.size * 2.6, 0.9, p.channel);
          dead = true;
        } else if ((i + Math.floor(time * 60)) % 3 === 0) {
          _from.set(p.pos.x, p.pos.y, p.pos.z);
          _to.set(p.pos.x, p.pos.y - p.size - Math.max(0.05, -p.vel.y * dt * 3), p.pos.z);
          _ray.reset();
          this.world.raycastClosest(_from, _to, { collisionFilterMask: GROUP.STATIC | GROUP.KINEMATIC | GROUP.DYNAMIC, skipBackfaces: true }, _ray);
          if (_ray.hasHit) {
            const b = _ray.body;
            if (p.stamp && b.type === CANNON.Body.STATIC && !b.userData?.isFloor) {
              _p.set(_ray.hitPointWorld.x, _ray.hitPointWorld.y, _ray.hitPointWorld.z);
              _d.set(_ray.hitNormalWorld.x, _ray.hitNormalWorld.y, _ray.hitNormalWorld.z);
              this.decals.spawn(_p, _d, p.size * 4, p.channel, time, 0.8);
            }
            dead = true;
          }
        }
      }
      if (dead) {
        // swap-remove
        const last = this.pool[--this.active];
        this.pool[this.active] = p;
        this.pool[i] = last;
        continue;
      }
      i++;
    }

    // write instances
    for (let k = 0; k < this.active; k++) {
      const p = this.pool[k];
      const t = p.life / p.max;
      const shrink = t < 0.35 ? t / 0.35 : 1;
      const sp = p.vel.length();
      const stretch = 1 + Math.min(sp * 0.09, 1.3);
      const sz = p.size * shrink;
      _s.set(sz / Math.sqrt(stretch), sz * stretch, sz / Math.sqrt(stretch));
      if (sp > 0.01) _q.setFromUnitVectors(_up, _d.copy(p.vel).divideScalar(sp));
      else _q.identity();
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(k, _m);
      this.mesh.setColorAt(k, p.color);
    }
    this.mesh.count = this.active;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.active = 0;
    this.mesh.count = 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
