import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createBlobShadowMaterial } from '../materials/SurfaceMaterials.js';
import { GROUP } from '../physics/PhysicsWorld.js';

const MAX = 160;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _from = new CANNON.Vec3();
const _to = new CANNON.Vec3();
const _ray = new CANNON.RaycastResult();

/**
 * Soft blob contact shadows. Characters always get a ray-cast blob that sits on
 * whatever surface is below them (scales / fades with height). With Ambient
 * Occlusion set to "contact" or higher, every dynamic prop near the floor also
 * gets a cheap contact-AO blob. One draw call for everything.
 */
export class ContactShadows {
  constructor(scene, world) {
    this.world = world;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.aOpacity = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOpacity', this.aOpacity);
    this.mesh = new THREE.InstancedMesh(geo, createBlobShadowMaterial(), MAX);
    this.mesh.name = 'ContactShadows';
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(1);
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.propAO = true;
  }

  update(characters, props, alpha) {
    let i = 0;
    for (const c of characters) {
      const pos = c.position;
      _from.set(pos.x, pos.y, pos.z);
      _to.set(pos.x, pos.y - 14, pos.z);
      _ray.reset();
      this.world.raycastClosest(_from, _to, { collisionFilterMask: GROUP.STATIC | GROUP.KINEMATIC | GROUP.DYNAMIC, skipBackfaces: true }, _ray);
      if (!_ray.hasHit) continue;
      const h = Math.max(0, _ray.distance - c.radius);
      _n.set(_ray.hitNormalWorld.x, _ray.hitNormalWorld.y, _ray.hitNormalWorld.z);
      _p.set(_ray.hitPointWorld.x, _ray.hitPointWorld.y, _ray.hitPointWorld.z).addScaledVector(_n, 0.015);
      _q.setFromUnitVectors(_up, _n);
      const size = c.radius * 2.5 * (1 + h * 0.18);
      _s.set(size, 1, size);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.aOpacity.array[i] = 0.62 * Math.max(0, 1 - h / 8);
      i++;
    }
    if (this.propAO) {
      for (const rec of props) {
        if (i >= MAX) break;
        const b = rec.body;
        const size = b.userData.size;
        if (!size) continue;
        const p = b.position;
        const half = size[1] * 0.5;
        const h = p.y - half;
        if (h > 2.5 || h < -0.2 || p.y > 4) continue;
        const ext = Math.max(size[0], size[2], size[1] * 0.6);
        _p.set(p.x, 0.012, p.z);
        _q.identity();
        _s.set(ext * 1.7, 1, ext * 1.7);
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(i, _m);
        this.aOpacity.array[i] = 0.38 * Math.max(0, 1 - Math.max(0, h) / 2.5);
        i++;
      }
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aOpacity.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
