import * as THREE from 'three';
import { litUniforms, registerMaterial } from './SharedUniforms.js';
import { toonVertex, toonFragment } from '../shaders/toon.js';

export const PATTERN = { none: 0, grid: 1, ice: 2, sticky: 3, bouncy: 4 };

/**
 * Custom GLSL cel-shading material (receives real shadow maps, fog, instancing,
 * instance colours and vertex colours).
 */
export function createToonMaterial({
  color = 0xffffff,
  vertexColors = false,
  map = null,
  specular = 0.35,
  gloss = 48,
  rim = 0.25,
  rimColor = 0xffffff,
  emissive = 0,
  pattern = 'none',
  patternColor = 0xffffff,
  side = THREE.FrontSide,
  name = 'Toon',
} = {}) {
  const uniforms = litUniforms({
    uColor: { value: new THREE.Color(color) },
    uPatternColor: { value: new THREE.Color(patternColor) },
    uSpecular: { value: specular },
    uGloss: { value: gloss },
    uRim: { value: rim },
    uRimColor: { value: new THREE.Color(rimColor) },
    uEmissive: { value: emissive },
    uMap: { value: map },
  });
  const defines = { PATTERN: PATTERN[pattern] ?? 0 };
  if (map) defines.USE_TOON_MAP = '';
  const fragmentShader = toonFragment;
  const m = new THREE.ShaderMaterial({
    name,
    uniforms,
    defines,
    vertexShader: toonVertex,
    fragmentShader,
    lights: true,
    fog: true,
    vertexColors,
    side,
  });
  return registerMaterial(m);
}
