// Graphics quality presets. Each preset fills every individual graphics option;
// the player can still override any single option afterwards.

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'];

export const QUALITY_PRESETS = {
  low: {
    shadowQuality: 'off',
    shadowResolution: 512,
    reflectionQuality: 'off',
    ambientOcclusion: 'off',
    particleQuality: 'low',
    textureQuality: 'low',
    renderScale: 0.75,
    antiAliasing: 'off',
  },
  medium: {
    shadowQuality: 'low',
    shadowResolution: 1024,
    reflectionQuality: 'low',
    ambientOcclusion: 'contact',
    particleQuality: 'medium',
    textureQuality: 'medium',
    renderScale: 0.9,
    antiAliasing: 'fxaa',
  },
  high: {
    shadowQuality: 'medium',
    shadowResolution: 2048,
    reflectionQuality: 'medium',
    ambientOcclusion: 'contact',
    particleQuality: 'high',
    textureQuality: 'high',
    renderScale: 1,
    antiAliasing: 'msaa',
  },
  ultra: {
    shadowQuality: 'high',
    shadowResolution: 4096,
    reflectionQuality: 'high',
    ambientOcclusion: 'ssao',
    particleQuality: 'ultra',
    textureQuality: 'high',
    renderScale: 1,
    antiAliasing: 'msaa',
  },
};

/** Max device pixel ratio allowed per preset (multiplied by renderScale). */
export const PIXEL_RATIO_CAP = { low: 1, medium: 1.5, high: 2, ultra: 2.5 };

export const PARTICLE_BUDGET = { low: 48, medium: 120, high: 220, ultra: 340 };
export const REFLECTION_SCALE = { off: 0, low: 0.25, medium: 0.4, high: 0.6 };
export const TEXTURE_SIZE = { low: 128, medium: 256, high: 512 };
export const SLIME_MAP_SIZE = { low: 1024, medium: 1536, high: 2048 };

export const GRAPHICS_KEYS = Object.keys(QUALITY_PRESETS.low);
