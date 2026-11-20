import * as CANNON from 'cannon-es';
import * as THREE from 'three';

const _tq = new THREE.Quaternion();

export const GROUP = {
  STATIC: 1,
  DYNAMIC: 2,
  CHARACTER: 4,
  KINEMATIC: 8,
  ALL: 0xffff,
};

/**
 * Wraps the cannon-es world: physics materials, the contact-material table,
 * live tuning from settings (gravity / bounce / friction) and per-body state
 * used for render interpolation.
 */
export class PhysicsWorld {
  constructor(settings) {
    this.settings = settings;
    const world = (this.world = new CANNON.World());
    world.gravity.set(0, -settings.get('gravity'), 0);
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    world.solver.iterations = 12;
    world.solver.tolerance = 0.0005;
    world.defaultContactMaterial.friction = 0.4;
    world.defaultContactMaterial.restitution = 0.2;
    world.defaultContactMaterial.contactEquationStiffness = 1e7;
    world.defaultContactMaterial.contactEquationRelaxation = 3;

    // ---- physics materials ----
    const M = (name) => new CANNON.Material(name);
    this.mat = {
      ground: M('ground'),
      slime: M('slime'),
      prop: M('prop'),
      ice: M('ice'),
      sticky: M('sticky'),
      bouncySoft: M('bouncySoft'),
      bouncyMed: M('bouncyMed'),
      bouncySuper: M('bouncySuper'),
      spring: M('spring'),
      wood: M('wood'),
      domino: M('domino'),
    };

    // base (unscaled) values; friction & restitution are multiplied by the
    // live settings so the sliders have a direct effect.
    this.contactDefs = [];
    const m = this.mat;
    const def = (a, b, friction, restitution, extra = {}) => {
      const cm = new CANNON.ContactMaterial(a, b, {
        friction,
        restitution,
        contactEquationStiffness: 1e7,
        contactEquationRelaxation: 3,
        frictionEquationStiffness: 1e7,
        frictionEquationRelaxation: 3,
        ...extra,
      });
      world.addContactMaterial(cm);
      this.contactDefs.push({ cm, friction, restitution, fixedFriction: !!extra.fixedFriction });
      return cm;
    };
    def(m.slime, m.ground, 0.55, 0.28);
    def(m.slime, m.prop, 0.4, 0.35);
    def(m.slime, m.wood, 0.5, 0.25);
    def(m.slime, m.slime, 0.15, 0.7);
    def(m.slime, m.ice, 0.0, 0.08, { fixedFriction: true });
    def(m.slime, m.sticky, 1.6, 0.0);
    def(m.slime, m.bouncySoft, 0.5, 0.6);
    def(m.slime, m.bouncyMed, 0.5, 0.85);
    def(m.slime, m.bouncySuper, 0.5, 1.05);
    def(m.slime, m.spring, 0.5, 0.3);
    def(m.prop, m.ground, 0.4, 0.25);
    def(m.prop, m.prop, 0.35, 0.3);
    def(m.prop, m.wood, 0.45, 0.2);
    def(m.wood, m.ground, 0.5, 0.15);
    def(m.wood, m.wood, 0.55, 0.1);
    def(m.prop, m.ice, 0.02, 0.1, { fixedFriction: true });
    def(m.wood, m.ice, 0.02, 0.05, { fixedFriction: true });
    def(m.prop, m.sticky, 1.2, 0.0);
    def(m.wood, m.sticky, 1.2, 0.0);
    def(m.prop, m.bouncySoft, 0.4, 0.6);
    def(m.prop, m.bouncyMed, 0.4, 0.85);
    def(m.prop, m.bouncySuper, 0.4, 1.0);
    def(m.wood, m.bouncyMed, 0.4, 0.7);
    def(m.wood, m.bouncySuper, 0.4, 0.95);
    // dominoes: grippy on the floor, slippery against each other -> they tip instead of sliding
    def(m.domino, m.ground, 0.9, 0.05);
    def(m.domino, m.domino, 0.08, 0.05);
    def(m.domino, m.slime, 0.4, 0.3);
    def(m.domino, m.prop, 0.3, 0.2);

    /** Bodies whose transform is interpolated for rendering. */
    this.tracked = [];
    this.applyTuning();
  }

  applyTuning() {
    const s = this.settings;
    this.world.gravity.set(0, -s.get('gravity'), 0);
    const b = s.get('bounce');
    const f = s.get('friction');
    for (const d of this.contactDefs) {
      d.cm.restitution = Math.min(d.restitution * b, 1.15);
      d.cm.friction = d.fixedFriction ? d.friction : d.friction * f;
    }
    // wake loose bodies so changes are visible immediately (stacked
    // structures stay asleep until something actually hits them)
    if (this._tunedOnce) for (const body of this.world.bodies) if (!body.userData?.stack) body.wakeUp();
    this._tunedOnce = true;
  }

  add(body, { track = false } = {}) {
    this.world.addBody(body);
    if (track) this.track(body);
    return body;
  }

  track(body) {
    body.userData = body.userData || {};
    body.userData.prevPos = body.position.clone();
    body.userData.prevQuat = body.quaternion.clone();
    this.tracked.push(body);
  }

  remove(body) {
    this.world.removeBody(body);
    const i = this.tracked.indexOf(body);
    if (i >= 0) this.tracked.splice(i, 1);
  }

  /** Store transforms before a fixed step (for interpolation). */
  savePrevious() {
    const t = this.tracked;
    for (let i = 0; i < t.length; i++) {
      const b = t[i];
      b.userData.prevPos.copy(b.position);
      b.userData.prevQuat.copy(b.quaternion);
    }
  }

  /** Call after teleporting a body so the interpolation doesn't streak. */
  static snap(body) {
    if (body.userData?.prevPos) {
      body.userData.prevPos.copy(body.position);
      body.userData.prevQuat.copy(body.quaternion);
    }
  }

  step(h) {
    this.world.step(h);
  }
}

/** Interpolated position/quaternion of a tracked body into THREE objects. */
export function interpolateBody(body, alpha, outPos, outQuat) {
  const p = body.userData.prevPos;
  const c = body.position;
  outPos.set(p.x + (c.x - p.x) * alpha, p.y + (c.y - p.y) * alpha, p.z + (c.z - p.z) * alpha);
  if (outQuat) {
    const q = body.userData.prevQuat;
    outQuat.set(q.x, q.y, q.z, q.w);
    _tq.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    outQuat.slerp(_tq, alpha);
  }
}

