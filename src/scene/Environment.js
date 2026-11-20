import * as THREE from 'three';
import { createSkyMaterial } from '../materials/SurfaceMaterials.js';
import { shared } from '../materials/SharedUniforms.js';

const _t = new THREE.Vector3();

/**
 * Sky dome, sun light (shadow caster), fog and the shared lighting uniforms.
 * The sun's shadow frustum follows the camera focus with texel snapping so
 * shadows stay crisp and don't shimmer.
 */
export class Environment {
  constructor(scene) {
    this.scene = scene;
    scene.fog = new THREE.Fog('#cfe8ff', 55, 150);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), createSkyMaterial());
    this.sky.name = 'Sky';
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.castShadow = true;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.035;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.intensity = 1;
    this.sun = sun;
    this.shadowExtent = 20;
    scene.add(sun, sun.target);
    this.setShadowExtent(20);
  }

  setShadowExtent(e) {
    this.shadowExtent = e;
    const c = this.sun.shadow.camera;
    c.left = -e;
    c.right = e;
    c.top = e;
    c.bottom = -e;
    c.updateProjectionMatrix();
  }

  setShadowResolution(size) {
    const s = this.sun.shadow;
    if (s.mapSize.x === size) return;
    s.mapSize.set(size, size);
    if (s.map) {
      s.map.dispose();
      s.map = null;
    }
  }

  setShadowSoftness(radius) {
    this.sun.shadow.radius = radius;
  }

  update(focus) {
    const L = shared.uLightDir.value;
    // snap the shadow frustum centre to shadow-map texels to avoid shimmering
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    _t.copy(focus);
    _t.x = Math.round(_t.x / texel) * texel;
    _t.z = Math.round(_t.z / texel) * texel;
    _t.y = 0;
    this.sun.target.position.copy(_t);
    this.sun.position.copy(_t).addScaledVector(L, 45);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(focus).setY(0);
  }

  dispose() {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.sun.shadow.map?.dispose();
  }
}
