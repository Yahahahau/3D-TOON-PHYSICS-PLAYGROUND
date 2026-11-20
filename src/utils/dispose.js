// Recursively dispose GPU resources owned by an Object3D tree.

export function disposeMaterial(material) {
  if (!material) return;
  const list = Array.isArray(material) ? material : [material];
  for (const m of list) {
    for (const key of Object.keys(m)) {
      const v = m[key];
      if (v && v.isTexture && !v.userData?.shared) v.dispose();
    }
    if (m.uniforms) {
      for (const u of Object.values(m.uniforms)) {
        const v = u && u.value;
        if (v && v.isTexture && !v.userData?.shared) v.dispose();
      }
    }
    m.dispose();
  }
}

export function disposeObject(root, { geometries = true, materials = true } = {}) {
  if (!root) return;
  root.traverse((obj) => {
    if (geometries && obj.geometry && !obj.geometry.userData?.shared) obj.geometry.dispose();
    if (materials && obj.material && !obj.material.userData?.shared) disposeMaterial(obj.material);
    if (obj.isInstancedMesh) obj.dispose?.();
  });
  root.removeFromParent();
}
