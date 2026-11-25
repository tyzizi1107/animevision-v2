export const DEFAULT_AVATAR = "default.jpg";
export const AVATAR_FILES = Array.from({ length: 20 }, (_, index) => `${index + 1}.jpg`);
export const AVATAR_OPTIONS = [DEFAULT_AVATAR, ...AVATAR_FILES] as const;

const CUSTOM_AVATAR_PATH = /^\/(?:api\/(?:account|compte)\/avatar|images\/avatar\/custom)\/[a-f0-9]{24}\/[\w-]+\.(?:gif|png|jpe?g|webp)$/i;

export function isCustomAvatar(value: unknown): value is string {
  return typeof value === "string" && CUSTOM_AVATAR_PATH.test(value);
}

export function isAvatarImage(value: unknown): value is (typeof AVATAR_OPTIONS)[number] {
  return typeof value === "string" && AVATAR_OPTIONS.includes(value as (typeof AVATAR_OPTIONS)[number]);
}

export function normalizeAvatar(value: unknown): string {
  return isAvatarImage(value) || isCustomAvatar(value) ? value : DEFAULT_AVATAR;
}

export function avatarImageSrc(value: unknown): string {
  const avatar = normalizeAvatar(value);
  if (isCustomAvatar(avatar)) return avatar.replace(/^\/images\/avatar\/custom\//, "/api/compte/avatar/");
  return `/images/avatar/${avatar}`;
}
