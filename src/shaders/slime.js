import { toonVertexPars, toonVertexBegin, toonVertexEnd, toonFragmentPars, toonFragmentEnd } from './chunks.js';

// ---------------------------------------------------------------------------
// Slime character body: jelly wobble in the vertex shader, cel shading with
// subsurface glow, glossy "window" highlight, fresnel rim, painted face details.
// ---------------------------------------------------------------------------

export const slimeVertex = /* glsl */ `
${toonVertexPars}
uniform float uWobble;
uniform float uTime;
uniform float uWobbleSpeed;
uniform float uSeed;
uniform vec3 uWobbleDir;  // local-space direction of latest impact
varying vec3 vObjN;

void main() {
  ${toonVertexBegin}
  vObjN = normalize(objectNormal);
  float t = uTime * uWobbleSpeed + uSeed;
  vec3 p = position * 2.0;
  float w = sin(p.x * 3.1 + t * 1.3) * sin(p.y * 2.7 + t * 1.1) * sin(p.z * 3.3 + t * 0.9);
  w += 0.5 * sin(dot(p, vec3(1.7, -2.3, 1.1)) * 2.0 + t * 2.1);
  float impact = max(dot(vObjN, uWobbleDir), 0.0);
  float jig = uWobble * (0.6 + 0.8 * impact);
  transformed += objectNormal * w * jig * 0.06;
  ${toonVertexEnd}
}
`;

export const slimeFragment = /* glsl */ `
${toonFragmentPars}
uniform vec3 uColor;
uniform vec3 uDeepColor;
uniform vec3 uGlowColor;
uniform vec3 uRimColor;
uniform float uMouthOpen;
uniform float uBlush;
varying vec3 vObjN;

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uLightDir;
  vec3 on = normalize(vObjN);

  // jelly body gradient: deeper colour toward the bottom / core
  vec3 albedo = mix(uDeepColor, uColor, smoothstep(-0.9, 0.6, on.y));

  // ---- painted face (object space, front hemisphere = +Z) ----
  vec2 fp = on.xy / (1.0 + max(on.z, 0.0));
  float front = smoothstep(0.2, 0.45, on.z);
  // smile
  vec2 mp = fp - vec2(0.0, -0.035);
  float smileD = abs(length(mp - vec2(0.0, 0.05)) - 0.085);
  float smile = (1.0 - smoothstep(0.009, 0.016, smileD)) * step(mp.y, 0.0) * (1.0 - uMouthOpen);
  // "o" mouth when surprised / falling
  vec2 op = (fp - vec2(0.0, -0.085)) / vec2(0.045, 0.055 * max(uMouthOpen, 0.01));
  float oMouth = (1.0 - smoothstep(0.85, 1.0, length(op))) * step(0.05, uMouthOpen);
  float mouth = max(smile, oMouth) * front;
  albedo = mix(albedo, vec3(0.12, 0.08, 0.22), mouth);
  // tongue hint inside the open mouth
  albedo = mix(albedo, vec3(0.95, 0.4, 0.5), oMouth * front * (1.0 - smoothstep(0.25, 0.6, length(op - vec2(0.0, -0.55)))));
  // blush
  vec2 bp = vec2(abs(fp.x) - 0.27, fp.y + 0.03) / vec2(0.065, 0.035);
  float blush = (1.0 - smoothstep(0.6, 1.0, length(bp))) * front * uBlush;
  albedo = mix(albedo, vec3(1.0, 0.55, 0.7), blush * 0.55);

  float shadow = getShadowMask();
  float ndl = dot(N, L);
  float lit = clamp(ndl * 0.85 + 0.15, 0.0, 1.0) * shadow;  // wrap lighting = soft squishy feel
  float band = toonBands(lit);
  vec3 ambient = hemiAmbient(N);
  vec3 shadowCol = albedo * (ambient * uShadowTint * 0.95 + uGlowColor * 0.12);
  vec3 litCol = albedo * (ambient * 0.5 + uLightColor * 0.95);
  vec3 col = mix(shadowCol, litCol, band);

  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 3.0);

  // subsurface: light leaking through thin edges and from behind
  float back = pow(max(dot(-V, L), 0.0), 2.0);
  col += uGlowColor * (smoothstep(0.35, 1.0, fres) * 0.35 + back * fres * 0.6) * (1.0 - mouth);

  // fake environment reflection (sky gradient), stronger at grazing angles
  vec3 R = reflect(-V, N);
  vec3 env = mix(uGroundColor * 0.8, uSkyColor * 1.15, smoothstep(-0.2, 0.5, R.y));
  col = mix(col, env, fres * 0.35);

  // toon rim light
  float rim = smoothstep(0.5, 0.56, fres * 1.4) * (0.45 + 0.55 * smoothstep(-0.4, 0.3, ndl));
  col += uRimColor * rim * 0.45;

  // sun specular (hard cel highlight)
  vec3 H = normalize(L + V);
  float sp = pow(max(dot(N, H), 0.0), 70.0);
  col += uLightColor * smoothstep(0.4, 0.46, sp) * shadow * 0.9;

  // glossy window highlight fixed in view space — the classic jelly sparkle
  vec3 nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
  float hl = dot(nv, normalize(vec3(-0.42, 0.55, 0.72)));
  float hl2 = dot(nv, normalize(vec3(-0.18, 0.72, 0.67)));
  col = mix(col, vec3(1.0), smoothstep(0.955, 0.965, hl) * 0.9);
  col = mix(col, vec3(1.0), smoothstep(0.988, 0.992, hl2) * 0.85);

  gl_FragColor = vec4(col, 1.0);
  ${toonFragmentEnd}
}
`;

// ---------------------------------------------------------------------------
// Inverted-hull outline (cartoon ink line).
// ---------------------------------------------------------------------------
export const outlineVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uThickness;
uniform float uWobble;
uniform float uTime;
uniform float uWobbleSpeed;
uniform float uSeed;
uniform vec3 uWobbleDir;
void main() {
  vec3 n = normalize(normal);
  float t = uTime * uWobbleSpeed + uSeed;
  vec3 p = position * 2.0;
  float w = sin(p.x * 3.1 + t * 1.3) * sin(p.y * 2.7 + t * 1.1) * sin(p.z * 3.3 + t * 0.9);
  w += 0.5 * sin(dot(p, vec3(1.7, -2.3, 1.1)) * 2.0 + t * 2.1);
  float impact = max(dot(n, uWobbleDir), 0.0);
  vec3 transformed = position + n * (w * uWobble * (0.6 + 0.8 * impact) * 0.06 + uThickness);
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const outlineFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ---------------------------------------------------------------------------
// Eye: white sclera, moving pupil, sparkles and blinking eyelid in one draw.
// ---------------------------------------------------------------------------
export const eyeVertex = /* glsl */ `
${toonVertexPars}
varying vec3 vObjN;
void main() {
  ${toonVertexBegin}
  vObjN = normalize(objectNormal);
  ${toonVertexEnd}
}
`;

export const eyeFragment = /* glsl */ `
${toonFragmentPars}
uniform vec2 uLook;
uniform float uBlink;
uniform float uPupilSize;
uniform vec3 uLidColor;
uniform vec3 uPupilColor;
varying vec3 vObjN;

void main() {
  vec3 n = normalize(vObjN);
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);

  vec3 c = normalize(vec3(uLook * 0.62, 1.0));
  float d = length(n - c);
  float pupil = 1.0 - smoothstep(uPupilSize - 0.03, uPupilSize, d);
  vec3 sclera = vec3(1.0);
  vec3 pupilCol = mix(uPupilColor, uPupilColor * 2.2 + vec3(0.05, 0.1, 0.2), smoothstep(uPupilSize * 0.3, uPupilSize, length(n - c - vec3(0.0, -0.12, 0.0))) * 0.6);
  vec3 col = mix(sclera, pupilCol, pupil);

  // sparkles (fixed relative to the pupil)
  float s1 = 1.0 - smoothstep(0.12, 0.15, length(n.xy - c.xy - vec2(0.17, 0.2)));
  float s2 = 1.0 - smoothstep(0.05, 0.07, length(n.xy - c.xy - vec2(-0.16, -0.17)));
  col = mix(col, vec3(1.0), max(s1, s2) * pupil);

  // eyelid: comes down from the top while blinking
  float lidLine = 1.05 - 2.2 * uBlink;
  float lid = smoothstep(lidLine - 0.02, lidLine + 0.02, n.y);
  float lidEdge = (1.0 - smoothstep(0.0, 0.06, abs(n.y - lidLine))) * step(0.02, uBlink);

  float shadow = getShadowMask();
  float ndl = dot(N, uLightDir);
  float band = toonBands(clamp(ndl * 0.6 + 0.4, 0.0, 1.0) * mix(0.6, 1.0, shadow));
  vec3 eyeCol = col * mix(vec3(0.78, 0.82, 0.95), vec3(1.0), band);
  // soft socket shade at the bottom of the eye
  eyeCol *= mix(0.86, 1.0, smoothstep(-0.9, -0.2, n.y));

  vec3 lidCol = toonShade(uLidColor, N, V, shadow, 0.2, 40.0, 0.0, vec3(1.0));
  vec3 outCol = mix(eyeCol, lidCol, lid);
  outCol = mix(outCol, vec3(0.1, 0.12, 0.25), lidEdge);

  gl_FragColor = vec4(outCol, 1.0);
  ${toonFragmentEnd}
}
`;
