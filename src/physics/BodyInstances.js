import * as THREE from 'three';
import { interpolateBody } from './PhysicsWorld.js';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

/**
 * One InstancedMesh rendering many physics bodies that share a geometry
 * (boxes, balls, cylinders…). Each instance has its own scale and colour.
 * Transforms are interpolated between fixed physics steps every frame.
 */
export class BodyInstances {
  constructor({ geometry, material, maxCount, castShadow = true, receiveShadow = true, name = 'Instances' }) {
    this.mesh = new THREE.InstancedMesh(geometry, material, maxCount);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    this.mesh.frustumCulled = false; // instances move everywhere
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.items = [];
  }

  add(body, scale, color) {
    const i = this.items.length;
    if (i >= this.mesh.instanceMatrix.count) throw new Error(`${this.mesh.name}: instance budget exceeded`);
    this.items.push({ body, scale: scale.clone() });
    this.mesh.setColorAt(i, _c.set(color));
    this.mesh.count = this.items.length;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return i;
  }

  update(alpha) {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      interpolateBody(it.body, alpha, _p, _q);
      _m.compose(_p, _q, it.scale);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
