import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { StaticBatcher } from './arena/StaticBatcher.js';
import { createCrateTexture } from './arena/textures.js';
import { BodyInstances } from '../physics/BodyInstances.js';
import { GROUP, PhysicsWorld } from '../physics/PhysicsWorld.js';
import { createToonMaterial } from '../materials/ToonMaterial.js';
import { createFloorMaterial, createLiquidMaterial } from '../materials/SurfaceMaterials.js';
import { TEXTURE_SIZE } from '../settings/presets.js';
import { makeRng } from '../utils/math.js';
import { disposeObject } from '../utils/dispose.js';

export const ARENA_SIZE = 72;
const HALF = ARENA_SIZE / 2;
const DEG = Math.PI / 180;

/**
 * The physics test arena: floor, boundary walls, stairs, ramps, bouncy pads,
 * spring pads, moving platforms, ice / sticky floors, a slime pool, tilted
 * platform, see-saw, rope bridge, dominoes and knock-down structures.
 * Every object has real collision.
 */
export class Arena {
  constructor({ scene, physics, settings, renderer }) {
    this.scene = scene;
    this.physics = physics;
    this.settings = settings;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = 'Arena';
    scene.add(this.group);

    this.dynamicBodies = []; // { body, pos, quat, sleep }
    this.kinematics = []; // { body, update(t) }
    this.springs = []; // { body, mesh, anim }
    this.liquids = []; // { minX, maxX, minZ, maxZ, surfaceY, material }
    this.ropes = null;

    this._buildMaterials();
    this._buildFloor();
    this.batch = new StaticBatcher(physics, this.lookMaterials);
    this._buildSets();

    this._buildWalls();
    this._buildStairs();
    this._buildRamps();
    this._buildBouncy();
    this._buildMoving();
    this._buildPool();
    this._buildIceAndSticky();
    this._buildSeesaw();
    this._buildBridge();
    this._buildDominoes();
    this._buildProps();

    for (const k of this.kinematics) {
      k.at(0, _target);
      k.body.position.set(_target.x, _target.y, _target.z);
      PhysicsWorld.snap(k.body);
    }
    this.staticMeshes = this.batch.build(this.group);
    for (const set of Object.values(this.sets)) this.group.add(set.mesh);
    this.update(0, 0);
  }

  // -------------------------------------------------------------------------
  _buildMaterials() {
    this.lookMaterials = {
      plain: createToonMaterial({ vertexColors: true, specular: 0.25, gloss: 40, rim: 0.18, name: 'Static-plain' }),
      grid: createToonMaterial({ vertexColors: true, specular: 0.2, gloss: 40, rim: 0.15, pattern: 'grid', name: 'Static-grid' }),
      ice: createToonMaterial({ vertexColors: true, specular: 0.9, gloss: 90, rim: 0.4, pattern: 'ice', patternColor: '#ffffff', name: 'Ice' }),
      sticky: createToonMaterial({ vertexColors: true, specular: 0.7, gloss: 60, rim: 0.2, pattern: 'sticky', patternColor: '#d1741f', name: 'Sticky' }),
      bouncy: createToonMaterial({ vertexColors: true, specular: 0.6, gloss: 50, rim: 0.3, pattern: 'bouncy', patternColor: '#ffffff', name: 'Bouncy' }),
    };
    const anis = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.crateTexture = createCrateTexture(TEXTURE_SIZE[this.settings.get('textureQuality')] || 256, anis);
    this.propMaterials = {
      box: createToonMaterial({ specular: 0.35, gloss: 50, rim: 0.25, name: 'Prop-box' }),
      crate: createToonMaterial({ map: this.crateTexture, specular: 0.15, gloss: 30, rim: 0.15, name: 'Prop-crate' }),
      ball: createToonMaterial({ specular: 0.8, gloss: 60, rim: 0.35, name: 'Prop-ball' }),
      cylinder: createToonMaterial({ specular: 0.45, gloss: 50, rim: 0.25, pattern: 'bouncy', patternColor: '#ffffff', name: 'Prop-cylinder' }),
      platform: createToonMaterial({ specular: 0.3, gloss: 40, rim: 0.2, pattern: 'grid', name: 'Prop-platform' }),
    };
  }

  setTextureQuality(q) {
    const anis = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const old = this.crateTexture;
    this.crateTexture = createCrateTexture(TEXTURE_SIZE[q] || 256, q === 'low' ? 1 : anis);
    this.propMaterials.crate.uniforms.uMap.value = this.crateTexture;
    old.dispose();
  }

  _buildFloor() {
    this.floorMaterial = createFloorMaterial();
    const geo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, this.floorMaterial);
    floor.name = 'Floor';
    floor.receiveShadow = true;
    floor.layers.set(1); // not drawn into its own planar reflection
    this.floor = floor;
    this.group.add(floor);

    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: this.physics.mat.ground, collisionFilterGroup: GROUP.STATIC });
    body.addShape(new CANNON.Plane());
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    body.userData = { surface: 'ground', static: true, isFloor: true };
    this.physics.add(body);
    this.floorBody = body;
  }

  _buildSets() {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const sphereGeo = new THREE.SphereGeometry(1, 24, 16);
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 24);
    this.sets = {
      box: new BodyInstances({ geometry: boxGeo, material: this.propMaterials.box, maxCount: 120, name: 'Boxes' }),
      crate: new BodyInstances({ geometry: boxGeo.clone(), material: this.propMaterials.crate, maxCount: 40, name: 'Crates' }),
      ball: new BodyInstances({ geometry: sphereGeo, material: this.propMaterials.ball, maxCount: 30, name: 'Balls' }),
      cylinder: new BodyInstances({ geometry: cylGeo, material: this.propMaterials.cylinder, maxCount: 30, name: 'Cylinders' }),
      platform: new BodyInstances({ geometry: boxGeo.clone(), material: this.propMaterials.platform, maxCount: 12, name: 'Platforms' }),
    };
  }

  // ---- helpers --------------------------------------------------------------
  _dynamic({ set, shape, size, mass, pos, rot = [0, 0, 0], color, mat = 'prop', sleep = false, scale, linearDamping = 0.05, angularDamping = 0.1, sleepSpeed = 0.05, sleepTime = 1.2 }) {
    const body = new CANNON.Body({
      mass,
      material: this.physics.mat[mat],
      collisionFilterGroup: GROUP.DYNAMIC,
      linearDamping,
      angularDamping,
    });
    body.addShape(shape);
    body.position.set(pos[0], pos[1], pos[2]);
    body.quaternion.setFromEuler(rot[0], rot[1], rot[2]);
    body.allowSleep = true;
    // low default limits so slowly tipping objects (dominoes) don't fall back
    // asleep mid chain-reaction; stacks use stickier limits to stop creeping
    body.sleepSpeedLimit = sleepSpeed;
    body.sleepTimeLimit = sleepTime;
    body.userData = { surface: mat, dynamic: true, size, stack: sleep };
    this.physics.add(body, { track: true });
    this.sets[set].add(body, scale, color);
    const rec = { body, pos: body.position.clone(), quat: body.quaternion.clone(), sleep };
    this.dynamicBodies.push(rec);
    if (sleep) body.sleep();
    return body;
  }

  dynBox(set, size, pos, opts = {}) {
    const he = new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2);
    const vol = size[0] * size[1] * size[2];
    return this._dynamic({
      set,
      shape: new CANNON.Box(he),
      size,
      mass: opts.mass ?? Math.max(0.2, vol * (opts.density ?? 0.6)),
      pos,
      scale: new THREE.Vector3(...size),
      ...opts,
    });
  }

  // ---- layout ---------------------------------------------------------------
  _buildWalls() {
    const h = 1.6;
    const t = 1;
    const c = '#8fb5ff';
    this.batch.box({ size: [ARENA_SIZE + 2 * t, h, t], pos: [0, h / 2, -HALF - t / 2], color: c });
    this.batch.box({ size: [ARENA_SIZE + 2 * t, h, t], pos: [0, h / 2, HALF + t / 2], color: c });
    this.batch.box({ size: [t, h, ARENA_SIZE], pos: [-HALF - t / 2, h / 2, 0], color: c });
    this.batch.box({ size: [t, h, ARENA_SIZE], pos: [HALF + t / 2, h / 2, 0], color: c });
    // cap stripe for a toy-like edge
    const cap = '#ffffff';
    this.batch.box({ size: [ARENA_SIZE + 2 * t + 0.2, 0.18, t + 0.2], pos: [0, h + 0.09, -HALF - t / 2], color: cap, collide: false, look: 'plain' });
    this.batch.box({ size: [ARENA_SIZE + 2 * t + 0.2, 0.18, t + 0.2], pos: [0, h + 0.09, HALF + t / 2], color: cap, collide: false, look: 'plain' });
    this.batch.box({ size: [t + 0.2, 0.18, ARENA_SIZE], pos: [-HALF - t / 2, h + 0.09, 0], color: cap, collide: false, look: 'plain' });
    this.batch.box({ size: [t + 0.2, 0.18, ARENA_SIZE], pos: [HALF + t / 2, h + 0.09, 0], color: cap, collide: false, look: 'plain' });
  }

  /** North: three staircases with different rise / run / width. */
  _buildStairs() {
    const defs = [
      { x: -8, steps: 6, rise: 0.2, run: 0.8, width: 3.2, color: '#ffb3c7' },
      { x: 0, steps: 5, rise: 0.36, run: 1.0, width: 4.2, color: '#ffd27a' },
      { x: 8.5, steps: 4, rise: 0.55, run: 1.35, width: 5.2, color: '#9fe3c4' },
    ];
    const z0 = -13;
    for (const d of defs) {
      for (let i = 0; i < d.steps; i++) {
        const h = d.rise * (i + 1);
        const z = z0 - d.run * i - d.run / 2;
        this.batch.box({ size: [d.width, h, d.run], pos: [d.x, h / 2, z], color: i % 2 ? d.color : shade(d.color, 1.07) });
      }
      // landing on top
      const top = d.rise * d.steps;
      const zl = z0 - d.run * d.steps - 2;
      this.batch.box({ size: [d.width, top, 4], pos: [d.x, top / 2, zl], color: shade(d.color, 0.92) });
    }
    // high bridge deck joining the landings, reachable by jumping
    this.batch.box({ size: [24, 0.4, 3], pos: [0.25, 2.4, -27.5], color: '#c9b6ff' });
    for (const x of [-11.5, 12]) this.batch.box({ size: [0.8, 2.2, 0.8], pos: [x, 1.1, -27.5], color: '#b49dff' });
  }

  /** East: ramps at 10°, 20°, 32° plus a launch kicker. */
  _buildRamps() {
    const defs = [
      { z: -6.5, angle: 10, color: '#a8c8ff' },
      { z: 0, angle: 20, color: '#c3a8ff' },
      { z: 6.5, angle: 32, color: '#ffa8b8' },
    ];
    const len = 8;
    const width = 4;
    const x0 = 14;
    for (const d of defs) {
      const a = d.angle * DEG;
      const rise = Math.sin(a) * len;
      const run = Math.cos(a) * len;
      const t = 0.4;
      // slab rotated around Z; centre lifted so the low edge touches the floor
      const cx = x0 + run / 2 + Math.sin(a) * (t / 2);
      const cy = rise / 2 - Math.cos(a) * (t / 2) + 0.01;
      this.batch.box({ size: [len, t, width], pos: [cx, cy, d.z], rot: [0, 0, a], color: d.color, mat: 'ground' });
      // top platform
      const px = x0 + run + 2;
      this.batch.box({ size: [4, rise, width], pos: [px, rise / 2, d.z], color: shade(d.color, 0.9) });
    }
    // kicker ramp near the centre — launches characters into the air
    const ka = 24 * DEG;
    this.batch.box({ size: [3, 0.3, 2.6], pos: [7.2, 0.5, 9], rot: [0, 0, ka], color: '#ffcf5c' });
    this.batch.box({ size: [0.6, 1.1, 2.6], pos: [8.5, 0.55, 9], color: '#f2b84b' });
  }

  /** West: trampolines with three restitution levels + spring launch pads. */
  _buildBouncy() {
    const pads = [
      { z: -6, mat: 'bouncySoft', color: '#b6f09c', r: 1.6 },
      { z: 0, mat: 'bouncyMed', color: '#ffcf5c', r: 1.6 },
      { z: 6, mat: 'bouncySuper', color: '#ff7aa8', r: 1.6 },
    ];
    for (const p of pads) {
      this.batch.cylinder({ radius: p.r, height: 0.3, pos: [-17, 0.15, p.z], color: p.color, look: 'bouncy', mat: p.mat });
      this.batch.cylinder({ radius: p.r + 0.2, height: 0.12, pos: [-17, 0.06, p.z], color: '#6d7fb3', look: 'plain', mat: 'ground', visual: true });
    }
    // bouncy wall
    this.batch.box({ size: [0.6, 2.4, 6], pos: [-30, 1.2, 0], color: '#ff9ccf', look: 'grid', mat: 'bouncySuper' });

    // spring pads: animated, give a strong vertical launch
    const springGeo = new THREE.CylinderGeometry(0.85, 1, 0.35, 24);
    const springMat = createToonMaterial({ color: '#ff6b6b', specular: 0.6, gloss: 50, rim: 0.3, pattern: 'bouncy', patternColor: '#ffe3e3', name: 'Spring' });
    for (const [x, z, power] of [[-24, -4, 15], [-24, 4, 19]]) {
      this.batch.cylinder({ radius: 1.2, height: 0.15, pos: [x, 0.075, z], color: '#6d7fb3', look: 'plain' });
      const mesh = new THREE.Mesh(springGeo, springMat);
      mesh.position.set(x, 0.15 + 0.175, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      const body = this.batch.cylinder({ radius: 1, height: 0.5, pos: [x, 0.25, z], visual: false, mat: 'spring', userData: { spring: power } });
      this.springs.push({ body, mesh, anim: 0, power });
    }
  }

  /** South: elevator, circular platform, slider, turntable. */
  _buildMoving() {
    const P = (size, color) => {
      const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.physics.mat.ground, collisionFilterGroup: GROUP.KINEMATIC });
      body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
      body.allowSleep = false;
      body.userData = { surface: 'ground', kinematic: true };
      this.physics.add(body, { track: true });
      this.sets.platform.add(body, new THREE.Vector3(...size), color);
      return body;
    };

    // elevator + high ledge
    const elev = P([3, 0.4, 3], '#7fd6ff');
    this.kinematics.push({
      body: elev,
      at: (t, out) => {
        const period = 9;
        const u = (t % period) / period;
        // pause at bottom and top
        let k;
        if (u < 0.2) k = 0;
        else if (u < 0.5) k = smooth((u - 0.2) / 0.3);
        else if (u < 0.7) k = 1;
        else k = 1 - smooth((u - 0.7) / 0.3);
        out.set(-12, 0.2 + k * 4.8, 26);
      },
    });
    this.batch.box({ size: [4, 5, 5], pos: [-12, 2.5, 30.2], color: '#ffd1a8' });

    // circular path platform
    const circ = P([2.8, 0.4, 2.8], '#ffb3e6');
    this.kinematics.push({
      body: circ,
      at: (t, out) => {
        const a = t * 0.55;
        out.set(-2 + Math.cos(a) * 4.2, 1.1, 26 + Math.sin(a) * 4.2);
      },
    });
    this.batch.cylinder({ radius: 0.35, height: 1.1, pos: [-2, 0.55, 26], color: '#d4a0ff', look: 'plain' });

    // linear slider
    const slide = P([3, 0.4, 2.4], '#a8f0c6');
    this.kinematics.push({
      body: slide,
      at: (t, out) => {
        out.set(-1 + Math.sin(t * 0.7) * 5, 1.25, 17);
      },
    });
    // turntable (kinematic cylinder spinning)
    const tt = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.physics.mat.ground, collisionFilterGroup: GROUP.KINEMATIC });
    tt.addShape(new CANNON.Cylinder(3.2, 3.2, 0.4, 20));
    tt.allowSleep = false;
    tt.userData = { surface: 'ground', kinematic: true };
    this.physics.add(tt, { track: true });
    this.sets.cylinder.add(tt, new THREE.Vector3(3.2, 0.4, 3.2), '#ffd27a');
    this.kinematics.push({
      body: tt,
      spin: 0.8,
      at: (t, out) => out.set(6, 0.2, 28),
    });
  }

  /** NW: slime pool with buoyancy and drag. */
  _buildPool() {
    const cx = -23;
    const cz = -23;
    const inner = 8;
    const wallH = 1.35;
    const t = 0.6;
    const c = '#7fd1c4';
    const half = inner / 2 + t / 2;
    this.batch.box({ size: [inner + 2 * t, wallH, t], pos: [cx, wallH / 2, cz - half], color: c });
    this.batch.box({ size: [inner + 2 * t, wallH, t], pos: [cx, wallH / 2, cz + half], color: c });
    this.batch.box({ size: [t, wallH, inner], pos: [cx - half, wallH / 2, cz], color: c });
    this.batch.box({ size: [t, wallH, inner], pos: [cx + half, wallH / 2, cz], color: c });
    // entry steps up to the rim
    this.batch.box({ size: [2.4, 0.45, 1.6], pos: [cx + half + 2.1, 0.225, cz + 2], color: shade(c, 1.1) });
    this.batch.box({ size: [1.2, 0.9, 1.6], pos: [cx + half + 0.9, 0.45, cz + 2], color: shade(c, 1.05) });

    const surfaceY = 1.18;
    const mat = createLiquidMaterial(inner / 2, inner / 2);
    const geo = new THREE.PlaneGeometry(inner, inner, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, surfaceY, cz);
    mesh.renderOrder = 2;
    mesh.name = 'SlimePool';
    this.group.add(mesh);
    this.liquids.push({
      minX: cx - inner / 2,
      maxX: cx + inner / 2,
      minZ: cz - inner / 2,
      maxZ: cz + inner / 2,
      surfaceY,
      material: mat,
      rippleIndex: 0,
    });
  }

  /** NE: ice rink and tilted platform. SW: sticky goo floor. */
  _buildIceAndSticky() {
    // ice
    this.batch.box({ size: [14, 0.14, 11], pos: [23, 0.07, -25], color: '#c4f1ff', look: 'ice', mat: 'ice' });
    // icy slope into the rink
    this.batch.box({ size: [5, 0.3, 4], pos: [23, 0.35, -17.4], rot: [-12 * DEG, 0, 0], color: '#c4f1ff', look: 'ice', mat: 'ice' });
    // tilted platform on a pedestal
    this.batch.box({ size: [1.2, 1.4, 1.2], pos: [13, 0.7, -32], color: '#b49dff' });
    this.batch.box({ size: [6, 0.4, 4], pos: [13, 1.6, -32], rot: [0, 0, -14 * DEG], color: '#d9c9ff' });

    // sticky goo
    this.batch.box({ size: [11, 0.12, 8], pos: [-23, 0.06, 17], color: '#ffb547', look: 'sticky', mat: 'sticky' });
  }

  /** SW: see-saw on a hinge. */
  _buildSeesaw() {
    const x = -23;
    const z = 28;
    const pivotY = 1.0;
    const fulcrum = this.batch.box({ size: [0.3, 0.7, 1.2], pos: [x, 0.35, z], color: '#8a7bd6' });
    this.batch.box({ size: [1.2, 0.12, 1.6], pos: [x, 0.06, z], color: '#6d5fc2', collide: false });
    const plank = this.dynBox('box', [7.5, 0.3, 1.8], [x, pivotY, z], { mass: 6, color: '#ff9f6b', linearDamping: 0.1, angularDamping: 0.3 });
    const hinge = new CANNON.HingeConstraint(fulcrum, plank, {
      pivotA: new CANNON.Vec3(0, pivotY - 0.35, 0),
      axisA: new CANNON.Vec3(0, 0, 1),
      pivotB: new CANNON.Vec3(0, 0, 0),
      axisB: new CANNON.Vec3(0, 0, 1),
    });
    hinge.collideConnected = false;
    this.physics.world.addConstraint(hinge);
    // weight block on one side to make it tip
    this.dynBox('crate', [0.9, 0.9, 0.9], [x + 3, pivotY + 0.8, z], { mass: 1.5, color: '#ffffff', mat: 'wood' });
  }

  /** SE: rope bridge of hinged planks between two towers. */
  _buildBridge() {
    const z = 22;
    const towerH = 2.4;
    const xa = 17;
    const xb = 29;
    const tw = 3;
    const ta = this.batch.box({ size: [tw, towerH, tw], pos: [xa, towerH / 2, z], color: '#d6c3ff' });
    const tb = this.batch.box({ size: [tw, towerH, tw], pos: [xb, towerH / 2, z], color: '#d6c3ff' });
    // access ramps
    const a = 22 * DEG;
    const len = towerH / Math.sin(a) + 0.4;
    this.batch.box({ size: [len, 0.3, 2.6], pos: [xa - tw / 2 - Math.cos(a) * len / 2 + 0.1, towerH / 2 - 0.1, z], rot: [0, 0, a], color: '#c3a8ff' });
    this.batch.box({ size: [len, 0.3, 2.6], pos: [xb + tw / 2 + Math.cos(a) * len / 2 - 0.1, towerH / 2 - 0.1, z], rot: [0, 0, -a], color: '#c3a8ff' });

    const start = xa + tw / 2;
    const end = xb - tw / 2;
    const n = 15;
    const gap = 0.06;
    const pw = (end - start - gap * (n + 1)) / n;
    const pd = 2.2;
    const th = 0.16;
    const y = towerH - th / 2;
    const planks = [];
    const sagDepth = 0.3;
    for (let i = 0; i < n; i++) {
      const x = start + gap + pw / 2 + i * (pw + gap);
      const t = (i + 0.5) / n;
      const sag = Math.sin(Math.PI * t) * sagDepth;
      const p = this.dynBox('box', [pw, th, pd], [x, y - sag, z], { mass: 0.9, color: i % 2 ? '#e3a35e' : '#d99250', mat: 'wood', linearDamping: 0.3, angularDamping: 0.6 });
      p.allowSleep = false;
      planks.push(p);
      // invisible suspension hanger: keeps the long chain from over-sagging
      // while still letting the bridge sway and bounce a little.
      const anchor = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
      anchor.position.set(x, y + 3.2, z);
      this.physics.world.addBody(anchor);
      const hang = new CANNON.DistanceConstraint(anchor, p, 3.2 + sag, 2e4);
      this.physics.world.addConstraint(hang);
    }
    const link = (A, pa, B, pb) => {
      const c = new CANNON.PointToPointConstraint(A, pa, B, pb, 1e5);
      c.collideConnected = false;
      this.physics.world.addConstraint(c);
    };
    const hx = pw / 2 + gap / 2;
    for (const side of [-1, 1]) {
      const zz = side * (pd / 2 - 0.1);
      link(ta, new CANNON.Vec3(tw / 2, towerH / 2 - th / 2, zz), planks[0], new CANNON.Vec3(-hx, 0, zz));
      for (let i = 0; i < n - 1; i++) link(planks[i], new CANNON.Vec3(hx, 0, zz), planks[i + 1], new CANNON.Vec3(-hx, 0, zz));
      link(planks[n - 1], new CANNON.Vec3(hx, 0, zz), tb, new CANNON.Vec3(-tw / 2, towerH / 2 - th / 2, zz));
    }
    // rope rails (visual, updated each frame)
    const pts = n + 2;
    const geo = new THREE.BufferGeometry();
    this._ropePos = new Float32Array((pts - 1) * 2 * 2 * 3 + 2 * 2 * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this._ropePos, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#7a4a22' }));
    lines.frustumCulled = false;
    this.group.add(lines);
    this.ropes = { lines, planks, ta: [xa + tw / 2, towerH + 0.6, z], tb: [xb - tw / 2, towerH + 0.6, z], hd: pd / 2 - 0.05 };
    // posts on the towers
    for (const x of [xa + tw / 2 - 0.15, xb - tw / 2 + 0.15]) for (const s of [-1, 1]) this.batch.box({ size: [0.2, 0.8, 0.2], pos: [x, towerH + 0.4, z + s * (pd / 2 - 0.05)], color: '#8a5a2e', collide: false, look: 'plain' });
  }

  /** SE: domino run + knock-down block tower and crate pyramid in the centre. */
  _buildDominoes() {
    const colors = ['#ff7aa8', '#ffd45c', '#5fe0b8', '#38b6ff', '#b18cff'];
    let i = 0;
    const N = 20;
    for (let k = 0; k < N; k++) {
      const t = k / (N - 1);
      const x = 13 + t * 18;
      const z = 12.5 + Math.sin(t * Math.PI * 1.5) * 1.4;
      const dx = 18 / (N - 1);
      const dz = (Math.cos(t * Math.PI * 1.5) * 1.4 * Math.PI * 1.5) / (N - 1);
      const yaw = -Math.atan2(dz, dx);
      this.dynBox('box', [0.2, 1.5, 0.85], [x, 0.75, z], { rot: [0, yaw, 0], mass: 0.5, mat: 'domino', angularDamping: 0.02, color: colors[i++ % colors.length], sleep: true });
    }
  }

  _buildProps() {
    const rng = makeRng(7);
    // keep scattered props away from the structures and the spawn point
    const keepOut = [[-6, -6, 3.6], [5, -6, 2.8], [0, 5, 3.2], [7.2, 9, 2.6]];
    const free = (x, z, r) => keepOut.every(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) > kr + r);
    const spot = (minR, maxR, zScale = 1, zOff = 0, r = 0.6) => {
      for (let k = 0; k < 40; k++) {
        const a = rng() * Math.PI * 2;
        const d = minR + rng() * (maxR - minR);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d * zScale + zOff;
        if (free(x, z, r)) return [x, z];
      }
      return [0, 12];
    };
    const candy = ['#ff7aa8', '#ffd45c', '#5fe0b8', '#7fc8ff', '#b18cff', '#ff9f6b'];

    // crate pyramid
    const cs = 1;
    let row = 4;
    let y = cs / 2;
    while (row > 0) {
      for (let i = 0; i < row; i++) {
        const x = -6 + (i - (row - 1) / 2) * (cs + 0.02);
        this.dynBox('crate', [cs, cs, cs], [x, y, -6], { mass: 1.2, color: '#ffffff', mat: 'wood', sleep: true, sleepSpeed: 0.15, sleepTime: 0.5 });
      }
      y += cs;
      row--;
    }

    // jenga-like block tower
    const bl = 1.5;
    const bh = 0.32;
    const bw = 0.48;
    for (let layer = 0; layer < 8; layer++) {
      const along = layer % 2 === 0;
      for (let j = 0; j < 3; j++) {
        const off = (j - 1) * (bw + 0.02);
        const pos = along ? [5 + off, bh / 2 + layer * bh, -6] : [5, bh / 2 + layer * bh, -6 + off];
        const size = along ? [bw, bh, bl] : [bl, bh, bw];
        this.dynBox('box', size, pos, { mass: 0.45, color: candy[(layer + j) % candy.length], mat: 'wood', sleep: true, sleepSpeed: 0.15, sleepTime: 0.5 });
      }
    }

    // scattered cubes of different sizes
    for (let i = 0; i < 9; i++) {
      const s = 0.55 + rng() * 0.8;
      const [cx, cz] = spot(5, 9, 0.8, 1, s);
      this.dynBox('box', [s, s, s], [cx, s / 2 + 0.01, cz], {
        rot: [0, rng() * 3, 0],
        color: candy[i % candy.length],
      });
    }
    // loose crates
    for (const [x, z] of [[-9, 4], [-10, 2.8], [10, -1], [-27, 10], [26, -10]]) this.dynBox('crate', [1, 1, 1], [x, 0.5, z], { mass: 1.2, color: '#ffffff', mat: 'wood' });

    // balls
    for (let i = 0; i < 12; i++) {
      const r = 0.28 + rng() * 0.45;
      const [bx, bz] = spot(4, 11, 1, 0, r);
      const body = this._dynamic({
        set: 'ball',
        shape: new CANNON.Sphere(r),
        size: [r * 2, r * 2, r * 2],
        mass: 0.25 + r * 0.8,
        pos: [bx, r + 0.5, bz],
        color: candy[(i + 2) % candy.length],
        scale: new THREE.Vector3(r, r, r),
        linearDamping: 0.08,
        angularDamping: 0.15,
      });
      body.userData.ball = true;
    }
    // beach balls in the pool
    for (const [x, z] of [[-24, -22], [-21.5, -24.5]]) {
      this._dynamic({ set: 'ball', shape: new CANNON.Sphere(0.45), size: [0.9, 0.9, 0.9], mass: 0.3, pos: [x, 1, z], color: '#ff7aa8', scale: new THREE.Vector3(0.45, 0.45, 0.45) });
    }

    // cylinders / barrels (some standing, some lying down)
    for (let i = 0; i < 8; i++) {
      const r = 0.35 + rng() * 0.3;
      const h = 0.8 + rng() * 0.8;
      const lying = i % 3 === 0;
      const [yx, yz] = spot(6, 11, 1, -2, Math.max(r, h / 2));
      this._dynamic({
        set: 'cylinder',
        shape: new CANNON.Cylinder(r, r, h, 14),
        size: [r * 2, h, r * 2],
        mass: 0.6 + r * h,
        pos: [yx, lying ? r + 0.02 : h / 2 + 0.02, yz],
        rot: lying ? [Math.PI / 2, rng() * 3, 0] : [0, 0, 0],
        color: candy[(i + 4) % candy.length],
        scale: new THREE.Vector3(r, h, r),
      });
    }
  }

  // -------------------------------------------------------------------------
  /** Called every fixed step BEFORE world.step: drive kinematic bodies. */
  fixedUpdate(t, h) {
    for (const k of this.kinematics) {
      const b = k.body;
      k.at(t + h, _target);
      b.velocity.set((_target.x - b.position.x) / h, (_target.y - b.position.y) / h, (_target.z - b.position.z) / h);
      if (k.spin) b.angularVelocity.set(0, k.spin, 0);
    }
  }

  /** Per-frame visual update (interpolated). */
  update(dt, alpha) {
    for (const set of Object.values(this.sets)) set.update(alpha);
    for (const s of this.springs) {
      s.anim = Math.max(0, s.anim - dt * 3.2);
      const k = s.anim;
      const squash = 1 - Math.sin(Math.min(k, 1) * Math.PI) * 0.45 * k;
      s.mesh.scale.set(1 + (1 - squash) * 0.4, squash, 1 + (1 - squash) * 0.4);
      s.mesh.position.y = 0.15 + 0.175 * squash;
    }
    this._updateRopes();
  }

  _updateRopes() {
    if (!this.ropes) return;
    const { planks, ta, tb, hd } = this.ropes;
    const arr = this._ropePos;
    let o = 0;
    for (const side of [-1, 1]) {
      // polyline: tower A post -> every plank's rail point -> tower B post
      let px = ta[0];
      let py = ta[1];
      let pz = ta[2] + side * hd;
      for (let i = 0; i <= planks.length; i++) {
        let nx, ny, nz;
        if (i < planks.length) {
          const p = planks[i];
          _v.set(0, 0.55, side * hd);
          _qq.set(p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w);
          _v.applyQuaternion(_qq);
          nx = p.position.x + _v.x;
          ny = p.position.y + _v.y;
          nz = p.position.z + _v.z;
        } else {
          nx = tb[0];
          ny = tb[1];
          nz = tb[2] + side * hd;
        }
        arr[o++] = px;
        arr[o++] = py;
        arr[o++] = pz;
        arr[o++] = nx;
        arr[o++] = ny;
        arr[o++] = nz;
        px = nx;
        py = ny;
        pz = nz;
      }
    }
    this.ropes.lines.geometry.setDrawRange(0, o / 3);
    this.ropes.lines.geometry.attributes.position.needsUpdate = true;
  }

  triggerSpring(body) {
    const s = this.springs.find((sp) => sp.body === body);
    if (s) s.anim = 1;
  }

  /** Put every movable object back to its initial state. */
  reset() {
    for (const rec of this.dynamicBodies) {
      const b = rec.body;
      b.position.copy(rec.pos);
      b.quaternion.copy(rec.quat);
      b.velocity.setZero();
      b.angularVelocity.setZero();
      b.force.setZero();
      b.torque.setZero();
      PhysicsWorld.snap(b);
      if (rec.sleep) b.sleep();
      else b.wakeUp();
    }
    for (const l of this.liquids) for (const r of l.material.uniforms.uRipples.value) r.set(0, 0, -100, 0);
  }

  dispose() {
    this.crateTexture.dispose();
    disposeObject(this.group);
  }
}

const _target = new THREE.Vector3();
const _v = new THREE.Vector3();
const _qq = new THREE.Quaternion();
const smooth = (t) => t * t * (3 - 2 * t);
function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}
