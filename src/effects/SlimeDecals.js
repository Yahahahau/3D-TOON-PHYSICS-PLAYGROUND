import * as THREE from 'three';
import { createDecalMaterial } from '../materials/SurfaceMaterials.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _yaw = new THREE.Quaternion();

/**
 * Slime blobs left on raised static surfaces (stairs, ramps, platforms).
 * A ring buffer of instanced quads; fading is done entirely in the shader from
 * each blob's birth time, so there is no per-frame CPU cost.
 */
export class SlimeDecals {
  constructor(scene, colorA, colorB, max = 360) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.aBirth = new THREE.InstancedBufferAttribute(new Float32Array(max).fill(-1e4), 1).setUsage(THREE.DynamicDrawUsage);
    this.aInfo = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBirth', this.aBirth);
    geo.setAttribute('aInfo', this.aInfo);
    this.material = createDecalMaterial(colorA, colorB);
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.name = 'SlimeDecals';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(1);
    this.mesh.renderOrder = 1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.head = 0;
    this.filled = 0;
  }

  get activeCount() {
    return this.filled;
  }

  spawn(point, normal, size, colorMix, time, strength = 1) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.filled = Math.min(this.max, this.filled + 1);
    _q.setFromUnitVectors(_up, normal);
    _yaw.setFromAxisAngle(_up, Math.random() * Math.PI * 2);
    _q.multiply(_yaw);
    _p.copy(point).addScaledVector(normal, 0.012);
    _s.set(size, 1, size * (0.8 + Math.random() * 0.4));
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.aBirth.array[i] = time;
    this.aInfo.array[i * 3] = colorMix;
    this.aInfo.array[i * 3 + 1] = Math.random();
    this.aInfo.array[i * 3 + 2] = strength;
    this.mesh.count = this.filled;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aBirth.needsUpdate = true;
    this.aInfo.needsUpdate = true;
  }

  setLifetime(sec) {
    this.material.uniforms.uLifetime.value = sec;
  }

  clear() {
    this.aBirth.array.fill(-1e4);
    this.aBirth.needsUpdate = true;
    this.filled = 0;
    this.head = 0;
    this.mesh.count = 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
