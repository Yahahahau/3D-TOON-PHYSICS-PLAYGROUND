// Shared GLSL snippets used by every custom toon shader.

/** Uniform declarations shared by all toon materials (values are shared JS objects). */
export const toonUniformsGLSL = /* glsl */ `
uniform vec3 uLightDir;      // world space, points TOWARD the sun
uniform vec3 uLightColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uShadowTint;
uniform float uTime;
`;

/**
 * Cel shading core. Three hard-ish bands (shadow / mid / lit), hemispheric soft
 * ambient, tinted shadow colour, toon specular and rim light.
 */
export const toonLightingGLSL = /* glsl */ `
vec3 hemiAmbient(vec3 N) {
  return mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
}

float toonBands(float l) {
  // soft cel steps: 0 -> 0.55 -> 1.0
  return smoothstep(0.015, 0.06, l) * 0.55 + smoothstep(0.42, 0.47, l) * 0.45;
}

float toonSpec(vec3 N, vec3 V, vec3 L, float gloss) {
  vec3 H = normalize(L + V);
  float s = pow(max(dot(N, H), 0.0), gloss);
  return smoothstep(0.45, 0.5, s);
}

float toonRim(vec3 N, vec3 V, float power) {
  float f = 1.0 - max(dot(N, V), 0.0);
  return smoothstep(0.55, 0.62, pow(f, power) * 1.6);
}

/** Generic stylised lit colour. shadow: 0 = fully shadowed, 1 = lit. */
vec3 toonShade(vec3 albedo, vec3 N, vec3 V, float shadow, float specAmt, float gloss, float rimAmt, vec3 rimColor) {
  vec3 L = uLightDir;
  float ndl = dot(N, L);
  float lit = clamp(ndl, 0.0, 1.0) * shadow;
  float band = toonBands(lit);
  vec3 ambient = hemiAmbient(N);
  vec3 shadowCol = albedo * ambient * uShadowTint;
  vec3 litCol = albedo * (ambient * 0.55 + uLightColor);
  vec3 col = mix(shadowCol, litCol, band);
  col += uLightColor * toonSpec(N, V, L, gloss) * specAmt * shadow;
  float rim = toonRim(N, V, 1.4) * rimAmt * (0.35 + 0.65 * smoothstep(-0.3, 0.3, ndl));
  col += rimColor * rim;
  return col;
}
`;

export const noiseGLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;

/** Common vertex prelude: world position + normal + shadow + fog support. */
export const toonVertexPars = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec2 vUv;
`;

/**
 * Vertex body. Expects `transformed` / `objectNormal` to already be adjusted
 * if the shader wants a deformation (place code between the two halves).
 */
export const toonVertexBegin = /* glsl */ `
  vUv = uv;
  #include <color_vertex>
  #include <beginnormal_vertex>
  #include <begin_vertex>
`;

export const toonVertexEnd = /* glsl */ `
  #include <defaultnormal_vertex>
  #include <project_vertex>
  vec4 wp4 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp4 = instanceMatrix * wp4;
  #endif
  wp4 = modelMatrix * wp4;
  vWorldPos = wp4.xyz;
  vNormalW = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
`;

export const toonFragmentPars = /* glsl */ `
#include <common>
#include <packing>
#include <color_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec2 vUv;
${toonUniformsGLSL}
${toonLightingGLSL}
`;

export const toonFragmentEnd = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
`;
