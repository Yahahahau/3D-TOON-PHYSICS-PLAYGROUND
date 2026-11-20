import * as THREE from 'three';

/** Procedural cartoon crate texture (no external assets). */
export function createCrateTexture(size = 256, anisotropy = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size / 256;
  g.fillStyle = '#e3a35e';
  g.fillRect(0, 0, size, size);
  // planks
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#d99250' : '#e8ad6b';
    g.fillRect(0, i * 64 * s, size, 64 * s);
    g.fillStyle = 'rgba(120,60,20,0.35)';
    g.fillRect(0, i * 64 * s, size, 3 * s);
    // wood grain
    g.strokeStyle = 'rgba(150,80,30,0.25)';
    g.lineWidth = 2 * s;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      const y = (i * 64 + 16 + k * 16) * s;
      g.moveTo(0, y);
      g.bezierCurveTo(size * 0.3, y - 6 * s, size * 0.6, y + 6 * s, size, y - 2 * s);
      g.stroke();
    }
  }
  // frame
  g.strokeStyle = '#a8612a';
  g.lineWidth = 26 * s;
  g.strokeRect(13 * s, 13 * s, size - 26 * s, size - 26 * s);
  g.strokeStyle = '#8a4a1c';
  g.lineWidth = 4 * s;
  g.strokeRect(26 * s, 26 * s, size - 52 * s, size - 52 * s);
  g.strokeRect(2 * s, 2 * s, size - 4 * s, size - 4 * s);
  // diagonal brace
  g.strokeStyle = '#b86d33';
  g.lineWidth = 22 * s;
  g.beginPath();
  g.moveTo(30 * s, size - 30 * s);
  g.lineTo(size - 30 * s, 30 * s);
  g.stroke();
  // nails
  g.fillStyle = '#5b3518';
  for (const [x, y] of [[13, 13], [243, 13], [13, 243], [243, 243]]) {
    g.beginPath();
    g.arc(x * s, y * s, 4 * s, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
