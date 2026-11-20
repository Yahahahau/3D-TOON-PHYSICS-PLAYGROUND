import { toonVertexPars, toonVertexBegin, toonVertexEnd, toonFragmentPars, toonFragmentEnd, noiseGLSL, toonUniformsGLSL } from './chunks.js';

// ---------------------------------------------------------------------------
// Arena floor: pastel tiles + grid, cel lighting, planar reflection, and the
// continuous liquid slime trail read from the top-down slime map.
// ---------------------------------------------------------------------------
export const floorVertex = /* glsl */ `
${toonVertexPars}
uniform mat4 uReflMatrix;
varying vec4 vReflCoord;
void main() {
  ${toonVertexBegin}
  ${toonVertexEnd}
  vReflCoord = uReflMatrix * vec4(vWorldPos, 1.0);
}
`;

export const floorFragment = /* glsl */ `
${toonFragmentPars}
${noiseGLSL}
uniform vec3 uBaseColor;
uniform vec3 uTileColor;
uniform vec3 uLineColor;
uniform sampler2D uSlimeMap;
uniform vec4 uSlimeRect;      // centerX, centerZ, size, texel
uniform vec3 uSlimeColorA;
uniform vec3 uSlimeColorB;
uniform sampler2D uReflection;
uniform float uReflStrength;
varying vec4 vReflCoord;

float slimeH(vec2 uv) {
  vec4 s = texture2D(uSlimeMap, uv);
  return max(s.r, s.g);
}

void main() {
  vec2 wp = vWorldPos.xz;
  vec3 V = normalize(cameraPosition - vWorldPos);

  // ---- base floor pattern ----
  float checker = mod(floor(wp.x * 0.5) + floor(wp.y * 0.5), 2.0);
  vec3 albedo = mix(uBaseColor, uTileColor, checker);
  vec2 g1 = abs(fract(wp - 0.5) - 0.5) / fwidth(wp);
  float line1 = 1.0 - min(min(g1.x, g1.y), 1.0);
  vec2 wp10 = wp * 0.1;
  vec2 g10 = abs(fract(wp10 - 0.5) - 0.5) / fwidth(wp10);
  float line10 = 1.0 - min(min(g10.x, g10.y) * 0.5, 1.0);
  albedo = mix(albedo, uLineColor, max(line1 * 0.35, line10 * 0.7));

  // ---- slime trail ----
  vec2 suv = (wp - uSlimeRect.xy) / uSlimeRect.z + 0.5;
  float tx = uSlimeRect.w * 1.5;
  vec4 s = texture2D(uSlimeMap, suv);
  float hc = max(s.r, s.g);
  float hR = slimeH(suv + vec2(tx, 0.0));
  float hL = slimeH(suv - vec2(tx, 0.0));
  float hU = slimeH(suv + vec2(0.0, tx));
  float hD = slimeH(suv - vec2(0.0, tx));
  float h = hc * 0.4 + (hR + hL + hU + hD) * 0.15;   // small blur = smooth liquid edges
  float hx = hR - hL;
  float hz = hU - hD;
  float shimmer = vnoise(wp * 2.0 + uTime * 0.25) - 0.5;
  float mask = smoothstep(0.1, 0.22, h);
  vec3 slimeN = normalize(vec3(-hx * 5.0 + shimmer * 0.06, 1.0, -hz * 5.0 + shimmer * 0.04));
  vec3 N = normalize(mix(vec3(0.0, 1.0, 0.0), slimeN, mask));
  vec3 slimeCol = mix(uSlimeColorA, uSlimeColorB, s.g / (s.r + s.g + 1e-4));

  float shadow = getShadowMask();
  vec3 col = toonShade(albedo, vec3(0.0, 1.0, 0.0), V, shadow, 0.0, 30.0, 0.0, vec3(1.0));

  // translucent goo: tinted body, darker rim at the edge, deeper colour where thick
  float ndlS = clamp(dot(N, uLightDir), 0.0, 1.0);
  vec3 gooLit = slimeCol * (hemiAmbient(N) * 0.55 + uLightColor * mix(0.3, 0.85, shadow) * (0.55 + 0.45 * ndlS));
  float edge = smoothstep(0.1, 0.15, h) - smoothstep(0.17, 0.32, h);
  vec3 gooBase = mix(col, gooLit, 0.82);
  gooBase = mix(gooBase, slimeCol * 0.5, edge * 0.6);
  gooBase = mix(gooBase, slimeCol * 0.75, smoothstep(0.4, 0.95, h) * 0.3);
  col = mix(col, gooBase, mask);

  // glossy cel highlights on the goo
  vec3 H = normalize(uLightDir + V);
  float sp = pow(max(dot(N, H), 0.0), 90.0);
  col += uLightColor * smoothstep(0.3, 0.38, sp) * mask * shadow * 1.2;
  // bright cel line on the light-facing edge of each puddle (thick liquid read)
  vec2 grad = vec2(-hx, -hz);
  float gl = length(grad);
  float edgeLight = smoothstep(0.2, 0.6, dot(grad / (gl + 1e-5), normalize(uLightDir.xz + 1e-5))) * smoothstep(0.03, 0.09, gl);
  col = mix(col, vec3(0.9, 0.98, 1.0), edgeLight * mask * 0.65);

  // ---- reflections (wet polished floor; stronger on slime) ----
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.04 + 0.5 * pow(1.0 - ndv, 4.0);
  vec3 R = reflect(-V, N);
  vec3 env = mix(uGroundColor, uSkyColor * 1.1, smoothstep(-0.1, 0.6, R.y));
  #ifdef USE_REFLECTION
    vec2 ruv = vReflCoord.xy / vReflCoord.w + N.xz * 0.06 * mask + shimmer * 0.004;
    vec3 refl = texture2D(uReflection, ruv).rgb;
    col = mix(col, refl, clamp((fres + mask * 0.22) * uReflStrength, 0.0, 0.8));
  #else
    col = mix(col, env, clamp(fres * 0.6 + mask * 0.15, 0.0, 0.6));
  #endif

  gl_FragColor = vec4(col, 1.0);
  ${toonFragmentEnd}
}
`;

// ---------------------------------------------------------------------------
// Slime map stamping (rendered into the top-down render target). Stamps are
// written with MAX blending, so overlapping strokes merge into one liquid body.
// ---------------------------------------------------------------------------
export const stampVertex = /* glsl */ `
attribute vec4 aStamp;   // x, z, radius, strength
attribute vec4 aInfo;    // channelR, channelG, seed, stretch angle
uniform vec4 uSlimeRect;
varying vec2 vP;
varying vec4 vInfo;
varying float vStrength;
void main() {
  vP = position.xy * 2.0;
  vInfo = aInfo;
  vStrength = aStamp.w;
  vec2 world = aStamp.xy + position.xy * aStamp.z * 2.0;
  vec2 ndc = (world - uSlimeRect.xy) / (uSlimeRect.z * 0.5);
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

export const stampFragment = /* glsl */ `
varying vec2 vP;
varying vec4 vInfo;
varying float vStrength;
void main() {
  float a = atan(vP.y, vP.x);
  float seed = vInfo.z * 6.2831;
  float wob = 1.0 + 0.09 * sin(a * 3.0 + seed) + 0.05 * sin(a * 5.0 + seed * 2.3) + 0.025 * sin(a * 9.0 + seed * 4.1);
  float r = length(vP) / (0.8 * wob);
  float prof = 1.0 - smoothstep(0.0, 1.0, r);
  prof = pow(prof, 0.5) * vStrength;
  if (prof <= 0.001) discard;
  gl_FragColor = vec4(vInfo.x * prof, vInfo.y * prof, 0.0, 1.0);
}
`;

export const fadeFragment = /* glsl */ `
uniform float uAmount;
void main() { gl_FragColor = vec4(uAmount, uAmount, 0.0, 0.0); }
`;

export const fullscreenVertex = /* glsl */ `
void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

// ---------------------------------------------------------------------------
// Slime decals for raised surfaces (stairs, ramps, platforms).
// ---------------------------------------------------------------------------
export const decalVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float aBirth;
attribute vec3 aInfo;   // colorMix, seed, strength
uniform float uTime;
uniform float uLifetime;
varying vec2 vP;
varying vec3 vInfo;
varying float vAge;
varying vec3 vWorldPos;
varying vec3 vNormalW;
void main() {
  vP = position.xz * 2.0;
  vInfo = aInfo;
  vAge = (uTime - aBirth) / uLifetime;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * vec3(0.0, 1.0, 0.0));
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  if (vAge > 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  #include <fog_vertex>
}
`;

export const decalFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${toonUniformsGLSL}
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec2 vP;
varying vec3 vInfo;
varying float vAge;
varying vec3 vWorldPos;
varying vec3 vNormalW;
void main() {
  float a = atan(vP.y, vP.x);
  float seed = vInfo.y * 6.2831;
  float wob = 1.0 + 0.18 * sin(a * 3.0 + seed) + 0.1 * sin(a * 5.0 + seed * 2.1);
  float r = length(vP) / (0.85 * wob);
  float h = (1.0 - r) * vInfo.z - vAge * 0.9;
  if (h <= 0.0) discard;
  float alpha = smoothstep(0.0, 0.06, h) * 0.85;
  vec3 col = mix(uColorA, uColorB, vInfo.x);
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = clamp(dot(N, uLightDir), 0.0, 1.0);
  col *= mix(uSkyColor * 0.7, uLightColor, 0.4 + 0.6 * ndl);
  col = mix(col, col * 0.6, smoothstep(0.12, 0.0, h) * 0.6);
  // glossy blob highlight offset toward the light
  vec2 lo = normalize(uLightDir.xz + 1e-4) * 0.35;
  float hl = 1.0 - smoothstep(0.12, 0.16, length(vP - lo * wob));
  col = mix(col, vec3(1.0), hl * smoothstep(0.1, 0.25, h) * 0.85);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ---------------------------------------------------------------------------
// Blob contact shadows (instanced, per-instance opacity).
// ---------------------------------------------------------------------------
export const blobVertex = /* glsl */ `
attribute float aOpacity;
varying vec2 vP;
varying float vOpacity;
void main() {
  vP = position.xz * 2.0;
  vOpacity = aOpacity;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

export const blobFragment = /* glsl */ `
uniform vec3 uColor;
varying vec2 vP;
varying float vOpacity;
void main() {
  float r = length(vP);
  float a = pow(1.0 - smoothstep(0.0, 1.0, r), 1.6) * vOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

// ---------------------------------------------------------------------------
// Slime pool liquid surface with ripples.
// ---------------------------------------------------------------------------
export const liquidVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
varying vec3 vWorldPos;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const liquidFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${toonUniformsGLSL}
${noiseGLSL}
uniform vec3 uColor;
uniform vec3 uDeepColor;
uniform vec4 uRipples[6];   // x, z, startTime, strength
uniform vec2 uHalfSize;
varying vec3 vWorldPos;
varying vec2 vUv;

float waveH(vec2 p) {
  float h = sin(p.x * 1.3 + uTime * 1.4) * 0.5 + sin(p.y * 1.7 - uTime * 1.1) * 0.5;
  h += (vnoise(p * 1.2 + uTime * 0.3) - 0.5) * 1.2;
  for (int i = 0; i < 6; i++) {
    vec4 r = uRipples[i];
    float t = uTime - r.z;
    if (t > 0.0 && t < 2.5 && r.w > 0.0) {
      float d = length(p - r.xy);
      float front = t * 2.6;
      h += sin((d - front) * 7.0) * exp(-abs(d - front) * 2.5) * r.w * (1.0 - t / 2.5) * 2.5;
    }
  }
  return h;
}

void main() {
  vec2 p = vWorldPos.xz;
  float e = 0.06;
  float h0 = waveH(p);
  float hx = waveH(p + vec2(e, 0.0)) - h0;
  float hz = waveH(p + vec2(0.0, e)) - h0;
  vec3 N = normalize(vec3(-hx * 0.9, 1.0, -hz * 0.9) );
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = clamp(dot(N, uLightDir), 0.0, 1.0);
  float band = smoothstep(0.55, 0.6, ndl);
  vec3 col = mix(uDeepColor, uColor, 0.45 + 0.4 * band + h0 * 0.06);
  // edge foam
  vec2 ed = uHalfSize - abs(vUv - 0.5) * 2.0 * uHalfSize;
  float foam = 1.0 - smoothstep(0.08, 0.3, min(ed.x, ed.y) + (vnoise(p * 4.0 + uTime) - 0.5) * 0.15);
  col = mix(col, vec3(0.88, 1.0, 0.97), foam * 0.85);
  vec3 H = normalize(uLightDir + V);
  float sp = pow(max(dot(N, H), 0.0), 90.0);
  col += uLightColor * smoothstep(0.3, 0.36, sp) * 0.9;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col = mix(col, uSkyColor * 1.15, fres * 0.45);
  gl_FragColor = vec4(col, 0.88);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ---------------------------------------------------------------------------
// Toon sky dome with banded gradient, cel sun and puffy clouds.
// ---------------------------------------------------------------------------
export const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

export const skyFragment = /* glsl */ `
${toonUniformsGLSL}
${noiseGLSL}
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.22, y));
  col = mix(col, uTop, smoothstep(0.25, 0.85, y));
  // cel sun
  float sd = dot(d, uLightDir);
  col = mix(col, vec3(1.0, 0.98, 0.88), smoothstep(0.9975, 0.998, sd));
  col += vec3(1.0, 0.9, 0.7) * smoothstep(0.96, 1.0, sd) * 0.18;
  // stylised clouds
  if (y > 0.02) {
    vec2 cp = d.xz / (y + 0.15) * 1.4 + vec2(uTime * 0.01, 0.0);
    float n = fbm(cp * 0.9);
    float c = smoothstep(0.56, 0.6, n);
    float shade = smoothstep(0.56, 0.7, fbm(cp * 0.9 + vec2(0.06, 0.08)));
    vec3 cloudCol = mix(vec3(1.0), vec3(0.86, 0.9, 1.0), shade);
    col = mix(col, cloudCol, c * smoothstep(0.02, 0.15, y) * 0.95);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;
