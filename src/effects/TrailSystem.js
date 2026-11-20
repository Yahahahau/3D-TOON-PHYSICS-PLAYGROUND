import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const _p = new THREE.Vector3();

/**
 * Emits slime along each character's path while (and only while) it touches
 * the ground. Floor contact -> continuous liquid strokes in the SlimeMap;
 * raised static surfaces -> blob decals. Nothing is emitted while airborne.
 */
export class TrailSystem {
  constructor({ slimeMap, decals }) {
    this.slimeMap = slimeMap;
    this.decals = decals;
    this.state = new Map();
  }

  _get(c) {
    if (!this.state.has(c)) this.state.set(c, { last: new THREE.Vector3(), has: false, decalLast: new THREE.Vector3(), hasDecal: false, idle: 0 });
    return this.state.get(c);
  }

  reset() {
    for (const s of this.state.values()) {
      s.has = false;
      s.hasDecal = false;
    }
  }

  /** Called after every fixed physics step. */
  step(c, channel, h, time) {
    const st = this._get(c);
    if (!c.grounded || !c.groundBody) {
      st.has = false;
      st.hasDecal = false;
      return;
    }
    const gb = c.groundBody;
    const p = c.groundPoint;
    const r = c.radius;
    const speed = Math.hypot(c.body.velocity.x, c.body.velocity.z);

    if (gb.userData?.isFloor && c.groundNormal.y > 0.9) {
      st.hasDecal = false;
      if (!st.has) {
        this.slimeMap.stamp(p.x, p.z, r * 0.75, 1, channel);
        st.last.copy(p);
        st.has = true;
        st.idle = 0;
        return;
      }
      const dist = Math.hypot(p.x - st.last.x, p.z - st.last.z);
      const spacing = 0.09;
      if (dist >= spacing) {
        const n = Math.min(8, Math.floor(dist / spacing));
        // thinner, streakier trail at speed; irregular thickness
        const base = r * (speed > 6 ? 0.66 : 0.78);
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const wob = 0.86 + 0.26 * Math.abs(Math.sin(time * 5.3 + i * 0.9 + channel * 3));
          _p.lerpVectors(st.last, p, t);
          this.slimeMap.stamp(_p.x, _p.z, base * wob, 1, channel);
          // occasional side droplets for an organic edge
          if (Math.random() < 0.05) {
            const a = Math.random() * Math.PI * 2;
            const d = base * (1.0 + Math.random() * 0.6);
            this.slimeMap.stamp(_p.x + Math.cos(a) * d, _p.z + Math.sin(a) * d, base * (0.2 + Math.random() * 0.25), 0.9, channel);
          }
        }
        st.last.copy(p);
        st.idle = 0;
      } else {
        // resting in place: the puddle underneath slowly spreads / stays fresh
        st.idle += h;
        if (st.idle > 0.35) {
          st.idle = 0;
          this.slimeMap.stamp(p.x, p.z, r * (0.75 + Math.random() * 0.2), 1, channel);
        }
      }
    } else if (gb.type === CANNON.Body.STATIC) {
      st.has = false;
      if (!st.hasDecal || st.decalLast.distanceTo(p) > 0.32) {
        this.decals.spawn(p, c.groundNormal, r * (1.1 + Math.random() * 0.4), channel, time, 1);
        st.decalLast.copy(p);
        st.hasDecal = true;
      }
    } else {
      st.has = false;
      st.hasDecal = false;
    }
  }
}
