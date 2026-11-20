// Device / capability detection helpers.

export const isCoarsePointer = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const isTouchDevice = () =>
  isCoarsePointer() || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && !matchMedia('(hover: hover)').matches);

export const isMobileUA = () =>
  /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS

/** Rough device tier guess used for the initial quality preset. */
export function guessQualityTier() {
  const mobile = isMobileUA() || isCoarsePointer();
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (mobile) {
    if (cores >= 8 && mem >= 6) return 'medium';
    if (cores <= 4 || mem <= 2) return 'low';
    return 'medium';
  }
  if (cores >= 8) return 'high';
  return 'medium';
}
