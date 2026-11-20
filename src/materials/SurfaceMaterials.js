import * as THREE from 'three';
import { litUniforms, registerMaterial, shared } from './SharedUniforms.js';
import {
  floorVertex,
  floorFragment,
  decalVertex,
  decalFragment,
  blobVertex,
  blobFragment,
  liquidVertex,
  liquidFragment,
  skyVertex,
  skyFragment,
} from '../shaders/surfaces.js';
import { slimeVertex, slimeFragment, outlineVertex, outlineFragment, eyeVertex, eyeFragment } from '../shaders/slime.js';

const placeholderTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
placeholderTex.needsUpdate = true;
placeholderTex.userData.shared = true;

export function createFloorMaterial() {
  const uniforms = litUniforms({
    uBaseColor: { value: new THREE.Color('#eef2fb') },
    uTileColor: { value: new THREE.Color('#e2e9f7') },
    uLineColor: { value: new THREE.Color('#bccbe6') },
    uSlimeMap: { value: placeholderTex },
    uSlimeRect: { value: new THREE.Vector4(0, 0, 72, 1 / 1024) },
    uSlimeColorA: { value: new THREE.Color('#2fb4ff') },
    uSlimeColorB: { value: new THREE.Color('#5c74ff') },
    uReflection: { value: placeholderTex },
    uReflMatrix: { value: new THREE.Matrix4() },
    uReflStrength: { value: 1 },
  });
  return registerMaterial(
    new THREE.ShaderMaterial({
      name: 'Floor',
      uniforms,
      vertexShader: floorVertex,
      fragmentShader: floorFragment,
      lights: true,
      fog: true,
      extensions: {},
    }),
  );
}

export function createDecalMaterial(colorA, colorB) {
  return registerMaterial(
    new THREE.ShaderMaterial({
      name: 'SlimeDecal',
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...shared,
        uLifetime: { value: 12 },
        uColorA: { value: new THREE.Color(colorA) },
        uColorB: { value: new THREE.Color(colorB) },
      },
      vertexShader: decalVertex,
      fragmentShader: decalFragment,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      fog: true,
    }),
  );
}

export function createBlobShadowMaterial() {
  return registerMaterial(
    new THREE.ShaderMaterial({
      name: 'BlobShadow',
      uniforms: { uColor: { value: new THREE.Color('#1c2a55') } },
      vertexShader: blobVertex,
      fragmentShader: blobFragment,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
  );
}

export function createLiquidMaterial(halfX, halfZ) {
  const ripples = [];
  for (let i = 0; i < 6; i++) ripples.push(new THREE.Vector4(0, 0, -100, 0));
  return registerMaterial(
    new THREE.ShaderMaterial({
      name: 'SlimePool',
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...shared,
        uColor: { value: new THREE.Color('#5fe6d0') },
        uDeepColor: { value: new THREE.Color('#1f9fb3') },
        uRipples: { value: ripples },
        uHalfSize: { value: new THREE.Vector2(halfX, halfZ) },
      },
      vertexShader: liquidVertex,
      fragmentShader: liquidFragment,
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
}

export function createSkyMaterial() {
  return registerMaterial(
    new THREE.ShaderMaterial({
      name: 'Sky',
      uniforms: {
        ...shared,
        uTop: { value: new THREE.Color('#5aa9f5') },
        uMid: { value: new THREE.Color('#9fd6ff') },
        uHorizon: { value: new THREE.Color('#ffe6d2') },
      },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
}

export function createSlimeMaterial({ color, deep, glow, rim, seed = 0 }) {
  const uniforms = litUniforms({
    uColor: { value: new THREE.Color(color) },
    uDeepColor: { value: new THREE.Color(deep) },
    uGlowColor: { value: new THREE.Color(glow) },
    uRimColor: { value: new THREE.Color(rim) },
    uWobble: { value: 0 },
    uWobbleSpeed: { value: 6 },
    uWobbleDir: { value: new THREE.Vector3(0, -1, 0) },
    uSeed: { value: seed },
    uMouthOpen: { value: 0 },
    uBlush: { value: 1 },
  });
  return registerMaterial(
    new THREE.ShaderMaterial({
      name: 'SlimeBody',
      uniforms,
      vertexShader: slimeVertex,
      fragmentShader: slimeFragment,
      lights: true,
      fog: true,
    }),
  );
}

/** Outline shares the wobble uniforms of the body so the ink line follows the jelly. */
export function createOutlineMaterial(bodyMaterial, color = '#1b2c5c', thickness = 0.022) {
  const bu = bodyMaterial.uniforms;
  return registerMaterial(
    new THREE.ShaderMaterial({
      name: 'SlimeOutline',
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uColor: { value: new THREE.Color(color) },
        uThickness: { value: thickness },
        uWobble: bu.uWobble,
        uWobbleSpeed: bu.uWobbleSpeed,
        uWobbleDir: bu.uWobbleDir,
        uSeed: bu.uSeed,
        uTime: shared.uTime,
      },
      vertexShader: outlineVertex,
      fragmentShader: outlineFragment,
      side: THREE.BackSide,
      fog: true,
    }),
  );
}

export function createEyeMaterial(lidColor) {
  const uniforms = litUniforms({
    uLook: { value: new THREE.Vector2() },
    uBlink: { value: 0 },
    uPupilSize: { value: 0.5 },
    uLidColor: { value: new THREE.Color(lidColor) },
    uPupilColor: { value: new THREE.Color('#14193a') },
  });
  return registerMaterial(
    new THREE.ShaderMaterial({
      name: 'SlimeEye',
      uniforms,
      vertexShader: eyeVertex,
      fragmentShader: eyeFragment,
      lights: true,
      fog: true,
    }),
  );
}
