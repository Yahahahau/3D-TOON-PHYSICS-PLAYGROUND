import * as THREE from 'three';

/**
 * Uniform objects shared (by reference) between every custom toon material so
 * that lighting / time only needs to be updated once per frame.
 */
export const shared = {
  uLightDir: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
  uLightColor: { value: new THREE.Color(1.0, 0.97, 0.9) },
  uSkyColor: { value: new THREE.Color(0.62, 0.74, 0.95) },
  uGroundColor: { value: new THREE.Color(0.55, 0.5, 0.62) },
  uShadowTint: { value: new THREE.Color(0.86, 0.86, 1.08) },
  uTime: { value: 0 },
};

/** Build a uniforms object for a lit ShaderMaterial (three light + fog uniforms merged in). */
export function litUniforms(extra = {}) {
  const u = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
  Object.assign(u, extra);
  for (const k of Object.keys(shared)) u[k] = shared[k];
  return u;
}

/** Every material created through our factories registers here so quality changes can recompile them. */
export const materialRegistry = new Set();
export function registerMaterial(m) {
  materialRegistry.add(m);
  m.addEventListener('dispose', () => materialRegistry.delete(m));
  return m;
}
