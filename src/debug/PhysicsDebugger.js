import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const COLORS = {
  static: new THREE.Color('#6c8cff'),
  dynamic: new THREE.Color('#38e08a'),
  sleeping: new THREE.Color('#8a94a8'),
  kinematic: new THREE.Color('#ffa938'),
  character: new THREE.Color('#ff4fa3'),
};

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _sq = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Physics debug visualisation: collider wireframes (exact cannon shapes),
 * world AABBs, velocity vectors and solver contact points. Built lazily when
 * enabled and fully disposed when switched off. Drawn on top of the scene
 * (no depth test) so it never hides the normal UI.
 */
export class PhysicsDebugger {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.enabled = false;
    this.group = null;
    this.contactCount = 0;
  }

  setEnabled(on) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this._build();
    else this._destroy();
  }

  _build() {
    const g = (this.group = new THREE.Group());
    g.name = 'PhysicsDebug';
    g.renderOrder = 999;
    this.mats = {};
    for (const [k, c] of Object.entries(COLORS)) this.mats[k] = new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.85 });
    this.geos = {
      box: new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
      sphere: circlesGeometry(),
      cylinder: new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 1, 12), 1),
      plane: planeGeometry(),
    };
    this.shapeLines = new Map(); // shape -> LineSegments

    // AABBs
    this.maxBoxes = 256;
    this.aabbPos = new Float32Array(this.maxBoxes * 24 * 3);
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(this.aabbPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.aabb = new THREE.LineSegments(ag, new THREE.LineBasicMaterial({ color: '#ffe066', depthTest: false, transparent: true, opacity: 0.45 }));
    this.aabb.frustumCulled = false;
    // velocity vectors
    this.velPos = new Float32Array(this.maxBoxes * 2 * 3);
    const vg = new THREE.BufferGeometry();
    vg.setAttribute('position', new THREE.BufferAttribute(this.velPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.vel = new THREE.LineSegments(vg, new THREE.LineBasicMaterial({ color: '#ff3b3b', depthTest: false, transparent: true }));
    this.vel.frustumCulled = false;
    // contacts
    this.maxContacts = 512;
    this.contactPos = new Float32Array(this.maxContacts * 3);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(this.contactPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.contacts = new THREE.Points(cg, new THREE.PointsMaterial({ color: '#ffffff', size: 7, sizeAttenuation: false, depthTest: false, transparent: true }));
    this.contacts.frustumCulled = false;
    for (const o of [this.aabb, this.vel, this.contacts]) o.renderOrder = 1000;
    g.add(this.aabb, this.vel, this.contacts);
    this.scene.add(g);
  }

  _destroy() {
    if (!this.group) return;
    this.scene.remove(this.group);
    for (const l of this.shapeLines.values()) l.removeFromParent();
    Object.values(this.geos).forEach((x) => x.dispose());
    Object.values(this.mats).forEach((x) => x.dispose());
    for (const o of [this.aabb, this.vel, this.contacts]) {
      o.geometry.dispose();
      o.material.dispose();
    }
    this.shapeLines.clear();
    this.group = null;
  }

  _lineFor(shape) {
    let l = this.shapeLines.get(shape);
    if (l) return l;
    let geo;
    if (shape instanceof CANNON.Box) geo = this.geos.box;
    else if (shape instanceof CANNON.Sphere) geo = this.geos.sphere;
    else if (shape instanceof CANNON.Cylinder) geo = this.geos.cylinder;
    else if (shape instanceof CANNON.Plane) geo = this.geos.plane;
    else return null;
    l = new THREE.LineSegments(geo, this.mats.static);
    l.matrixAutoUpdate = false;
    l.frustumCulled = false;
    l.renderOrder = 999;
    this.group.add(l);
    this.shapeLines.set(shape, l);
    return l;
  }

  update() {
    if (!this.enabled || !this.group) return;
    const bodies = this.world.bodies;
    const seen = new Set();
    let ai = 0;
    let vi = 0;
    for (const b of bodies) {
      if (b.shapes.length === 0) continue;
      let kind = 'static';
      if (b.userData?.isCharacter) kind = 'character';
      else if (b.type === CANNON.Body.KINEMATIC) kind = 'kinematic';
      else if (b.type === CANNON.Body.DYNAMIC) kind = b.sleepState === CANNON.Body.SLEEPING ? 'sleeping' : 'dynamic';
      for (let i = 0; i < b.shapes.length; i++) {
        const shape = b.shapes[i];
        const line = this._lineFor(shape);
        if (!line) continue;
        seen.add(shape);
        line.material = this.mats[kind];
        // world transform of the shape
        const off = b.shapeOffsets[i];
        const so = b.shapeOrientations[i];
        _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        _p.set(off.x, off.y, off.z).applyQuaternion(_q).add(_s.set(b.position.x, b.position.y, b.position.z));
        _sq.set(so.x, so.y, so.z, so.w);
        _q.multiply(_sq);
        if (shape instanceof CANNON.Box) _s.set(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
        else if (shape instanceof CANNON.Sphere) _s.setScalar(shape.radius);
        else if (shape instanceof CANNON.Cylinder) _s.set(shape.radiusTop, shape.height, shape.radiusTop);
        else _s.set(40, 40, 40);
        line.matrix.compose(_p, _q, _s);
        line.matrixWorldNeedsUpdate = true;
      }
      // AABB + velocity (skip the infinite floor plane)
      if (b.shapes[0] instanceof CANNON.Plane) continue;
      if (ai < this.maxBoxes) {
        b.updateAABB?.();
        writeBox(this.aabbPos, ai++, b.aabb.lowerBound, b.aabb.upperBound);
      }
      if (b.type !== CANNON.Body.STATIC && vi < this.maxBoxes) {
        const o = vi * 6;
        const v = b.velocity;
        this.velPos[o] = b.position.x;
        this.velPos[o + 1] = b.position.y;
        this.velPos[o + 2] = b.position.z;
        this.velPos[o + 3] = b.position.x + v.x * 0.25;
        this.velPos[o + 4] = b.position.y + v.y * 0.25;
        this.velPos[o + 5] = b.position.z + v.z * 0.25;
        vi++;
      }
    }
    for (const [shape, line] of this.shapeLines) {
      if (!seen.has(shape)) {
        line.removeFromParent();
        this.shapeLines.delete(shape);
      }
    }
    this.aabb.geometry.setDrawRange(0, ai * 24);
    this.aabb.geometry.attributes.position.needsUpdate = true;
    this.vel.geometry.setDrawRange(0, vi * 2);
    this.vel.geometry.attributes.position.needsUpdate = true;

    let ci = 0;
    for (const c of this.world.contacts) {
      if (ci >= this.maxContacts) break;
      const o = ci * 3;
      this.contactPos[o] = c.bi.position.x + c.ri.x;
      this.contactPos[o + 1] = c.bi.position.y + c.ri.y;
      this.contactPos[o + 2] = c.bi.position.z + c.ri.z;
      ci++;
    }
    this.contactCount = ci;
    this.contacts.geometry.setDrawRange(0, ci);
    this.contacts.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this._destroy();
  }
}

function writeBox(arr, i, lo, hi) {
  const x0 = lo.x, y0 = lo.y, z0 = lo.z, x1 = hi.x, y1 = hi.y, z1 = hi.z;
  const e = [
    x0, y0, z0, x1, y0, z0, x1, y0, z0, x1, y0, z1, x1, y0, z1, x0, y0, z1, x0, y0, z1, x0, y0, z0,
    x0, y1, z0, x1, y1, z0, x1, y1, z0, x1, y1, z1, x1, y1, z1, x0, y1, z1, x0, y1, z1, x0, y1, z0,
    x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0, x1, y0, z1, x1, y1, z1, x0, y0, z1, x0, y1, z1,
  ];
  arr.set(e, i * 72);
}

function circlesGeometry() {
  const seg = 32;
  const pts = [];
  for (let axis = 0; axis < 3; axis++) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a) => (axis === 0 ? [Math.cos(a), Math.sin(a), 0] : axis === 1 ? [Math.cos(a), 0, Math.sin(a)] : [0, Math.cos(a), Math.sin(a)]);
      pts.push(...p(a0), ...p(a1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function planeGeometry() {
  // cannon planes face +Z in local space
  const pts = [];
  for (let i = -4; i <= 4; i++) {
    const t = i / 4;
    pts.push(-1, t, 0, 1, t, 0, t, -1, 0, t, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}
