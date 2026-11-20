import { toonVertexPars, toonVertexBegin, toonVertexEnd, toonFragmentPars, toonFragmentEnd, noiseGLSL } from './chunks.js';

export const toonVertex = /* glsl */ `
${toonVertexPars}
void main() {
  ${toonVertexBegin}
  ${toonVertexEnd}
}
`;

export const toonFragment = /* glsl */ `
${toonFragmentPars}
${noiseGLSL}
uniform vec3 uColor;
uniform vec3 uPatternColor;
uniform float uSpecular;
uniform float uGloss;
uniform float uRim;
uniform vec3 uRimColor;
uniform float uEmissive;
#ifdef USE_TOON_MAP
uniform sampler2D uMap;
#endif

void main() {
  vec3 albedo = uColor;
  #ifdef USE_COLOR
    albedo *= vColor.rgb;
  #endif
  #ifdef USE_TOON_MAP
    albedo *= texture2D(uMap, vUv).rgb;
  #endif

  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);

  float specAmt = uSpecular;
  float gloss = uGloss;

  #if PATTERN == 1
    // world-space measuring grid for platforms / stairs
    vec3 ap = abs(N);
    vec2 gp = ap.y > 0.7 ? vWorldPos.xz : (ap.x > ap.z ? vWorldPos.zy : vWorldPos.xy);
    vec2 g = abs(fract(gp - 0.5) - 0.5) / fwidth(gp);
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    albedo = mix(albedo, albedo * 0.86, line * 0.8);
  #elif PATTERN == 2
    // ice: glossy streaks + sparkles
    float streak = smoothstep(0.62, 0.7, fract((vWorldPos.x + vWorldPos.z) * 0.45 + vnoise(vWorldPos.xz * 0.6) * 0.6));
    albedo = mix(albedo, uPatternColor, streak * 0.55);
    float crack = smoothstep(0.03, 0.0, abs(vnoise(vWorldPos.xz * 1.3) - 0.5));
    albedo = mix(albedo, uPatternColor * 1.1, crack * 0.6);
    float sparkle = step(0.985, hash12(floor(vWorldPos.xz * 9.0))) * (0.5 + 0.5 * sin(uTime * 4.0 + hash12(floor(vWorldPos.xz * 9.0)) * 30.0));
    albedo += sparkle * 0.5;
    specAmt *= 1.6;
  #elif PATTERN == 3
    // sticky honey goo: blobs and darker pockets
    float n = fbm(vWorldPos.xz * 1.4 + vec2(0.0, uTime * 0.05));
    albedo = mix(albedo, uPatternColor, smoothstep(0.45, 0.6, n));
    float bub = smoothstep(0.18, 0.12, length(fract(vWorldPos.xz * 1.2 + vnoise(vWorldPos.xz) * 0.4) - 0.5));
    albedo = mix(albedo, albedo * 1.25, bub * 0.6);
  #elif PATTERN == 4
    // bouncy rings on top caps (cylinder cap UVs are radial around 0.5)
    float r = length(vUv - 0.5) * 2.0;
    float ring = smoothstep(0.42, 0.5, fract(r * 3.0)) * smoothstep(0.98, 0.9, fract(r * 3.0));
    albedo = mix(albedo, uPatternColor, ring * step(0.7, N.y));
  #endif

  float shadow = getShadowMask();
  vec3 col = toonShade(albedo, N, V, shadow, specAmt, gloss, uRim, uRimColor);
  col += albedo * uEmissive;

  gl_FragColor = vec4(col, 1.0);
  ${toonFragmentEnd}
}
`;
