import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUP } from '../../physics/PhysicsWorld.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();

/**
 * Collects static level geometry, creates the matching static physics bodies,
 * and merges all visuals that share a look into ONE mesh (few draw calls).
 */
export class StaticBatcher {
  constructor(physics, materials) {
    this.physics = physics;
    this.materials = materials; // look -> material
    this.buckets = new Map();
    this.bodies = [];
  }

  _push(look, geometry, color) {
    const n = geometry.attributes.position.count;
    const colors = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = _c.r;
      colors[i * 3 + 1] = _c.g;
      colors[i * 3 + 2] = _c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!this.buckets.has(look)) this.buckets.set(look, []);
    this.buckets.get(look).push(geometry);
  }

  /**
   * size: [x,y,z], pos: [x,y,z], rot: euler [x,y,z] (radians)
   */
  box({ size, pos, rot = [0, 0, 0], color = '#ffffff', look = 'grid', mat = 'ground', visual = true, collide = true, userData }) {
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    if (visual) {
      const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
      _m.compose(new THREE.Vector3(...pos), _q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(_m);
      this._push(look, g, color);
    }
    let body = null;
    if (collide) {
      body = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.STATIC,
        material: this.physics.mat[mat],
        collisionFilterGroup: GROUP.STATIC,
      });
      body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
      body.position.set(pos[0], pos[1], pos[2]);
      body.quaternion.set(_q.x, _q.y, _q.z, _q.w);
      body.userData = { surface: mat, static: true, ...userData };
      this.physics.add(body);
      this.bodies.push(body);
    }
    return body;
  }

  cylinder({ radius, height, pos, color = '#ffffff', look = 'plain', mat = 'ground', segments = 28, visual = true, userData }) {
    if (visual) {
      const g = new THREE.CylinderGeometry(radius, radius, height, segments);
      g.translate(pos[0], pos[1], pos[2]);
      this._push(look, g, color);
    }
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: this.physics.mat[mat],
      collisionFilterGroup: GROUP.STATIC,
    });
    body.addShape(new CANNON.Cylinder(radius, radius, height, Math.min(segments, 16)));
    body.position.set(pos[0], pos[1], pos[2]);
    body.userData = { surface: mat, static: true, ...userData };
    this.physics.add(body);
    this.bodies.push(body);
    return body;
  }

  /** Visual-only geometry (decorations). */
  visualOnly(look, geometry, color) {
    this._push(look, geometry, color);
  }

  build(parent) {
    const meshes = [];
    for (const [look, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.materials[look]);
      mesh.name = `static-${look}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}
