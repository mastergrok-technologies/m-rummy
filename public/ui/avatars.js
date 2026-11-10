/** Shared allowlist: never interpolate stored values into an asset URL. */
export const avatars = Object.freeze([
  '/assets/figma/avatar-1.png',
  '/assets/figma/avatar-2.svg',
  '/assets/figma/avatar-3.svg',
  '/assets/figma/avatar-4.svg',
  '/assets/figma/avatar-5.png',
]);
export const avatarSource = id => Number.isInteger(id) && id >= 1 && id <= avatars.length ? avatars[id - 1] : null;
