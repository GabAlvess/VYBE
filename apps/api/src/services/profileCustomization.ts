export type CustomizationApp = 'SOCIAL' | 'ECHO' | 'MATCH';
export type ProfileCustomization = { nameColor?: string; primaryFontId?: string; secondaryFontId?: string; nameFont?: string; fontId?: string; avatarFrame?: string; profileTheme?: string };
export type AppCustomizations = Partial<Record<CustomizationApp, ProfileCustomization>>;

const LEGACY_NAME_COLORS = new Set(['DEFAULT', 'TEAL', 'CORAL', 'LILAC', 'GOLD', 'BLUE', 'PINK', 'GRAPHITE']);
export function normalizeProfileNameColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toUpperCase();
  const normalized = /^[0-9A-F]{6}$/.test(raw) ? `#${raw}` : raw;
  return LEGACY_NAME_COLORS.has(normalized) || /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

export const defaultProfileCustomization: Required<Pick<ProfileCustomization, 'nameColor' | 'primaryFontId' | 'secondaryFontId' | 'avatarFrame' | 'profileTheme'>> = {
  nameColor: 'DEFAULT',
  primaryFontId: 'DEFAULT',
  secondaryFontId: 'DEFAULT',
  avatarFrame: 'NONE',
  profileTheme: 'DEFAULT',
};

export function resolveProfileCustomization(apps: AppCustomizations | undefined, legacy: ProfileCustomization | undefined, app: CustomizationApp) {
  // Legacy customization belongs to the original Social profile. Never seed Echo or Match from it.
  const legacyForApp = app === 'SOCIAL' ? legacy : undefined;
  const current = apps?.[app] ?? legacyForApp ?? {};
  const compatible = { ...current };
  delete compatible.nameFont;
  delete compatible.fontId;
  return {
    ...defaultProfileCustomization,
    ...compatible,
    primaryFontId: current.primaryFontId ?? current.nameFont ?? current.fontId ?? legacyForApp?.primaryFontId ?? legacyForApp?.nameFont ?? legacyForApp?.fontId ?? 'DEFAULT',
    secondaryFontId: current.secondaryFontId ?? legacyForApp?.secondaryFontId ?? 'DEFAULT',
  };
}

export function updateProfileCustomization(apps: AppCustomizations | undefined, legacy: ProfileCustomization | undefined, app: CustomizationApp, patch: ProfileCustomization): AppCustomizations {
  return { ...apps, [app]: { ...resolveProfileCustomization(apps, legacy, app), ...patch } };
}
