export const VYBE_FONT_CATEGORIES = [
  { id: 'modern', label: 'Modernas' },
  { id: 'elegant', label: 'Elegantes' },
  { id: 'script', label: 'Manuscritas' },
  { id: 'display', label: 'Display' },
  { id: 'delicate', label: 'Delicadas' },
  { id: 'youth', label: 'Jovens' },
  { id: 'tech', label: 'Tech' },
  { id: 'editorial', label: 'Editorial' },
  { id: 'mono', label: 'Monoespaçadas' },
] as const;

export type VybeFontCategory = typeof VYBE_FONT_CATEGORIES[number]['id'];
export const VYBE_DEFAULT_FONT_ID = 'DEFAULT';

const fontGroups: Record<VybeFontCategory, string[]> = {
  modern: ['Inter','Montserrat','Poppins','Roboto','Open Sans','Lato','Nunito','Nunito Sans','Manrope','DM Sans','Work Sans','Rubik','Raleway','Ubuntu','Mulish','Figtree','Outfit','Urbanist','Plus Jakarta Sans','Lexend','Quicksand','Cabin','Karla','Barlow','Assistant','Titillium Web','Source Sans 3','Noto Sans','IBM Plex Sans','Public Sans','Archivo','Hind','Heebo','Maven Pro','Sen','Jost','Varela Round','Red Hat Display','Space Grotesk','Sora','Onest','Geologica'],
  elegant: ['Playfair Display','Cormorant Garamond','Libre Baskerville','Lora','Merriweather','Crimson Text','EB Garamond','DM Serif Display','Bodoni Moda','Cinzel','Prata','Cardo','Spectral','Noto Serif','Source Serif 4','Libre Caslon Text','Alegreya','Vollkorn','Bitter','Zilla Slab','Arvo','PT Serif','Old Standard TT','Marcellus','Forum','Cormorant','Cormorant Infant','Cormorant SC','Alice','Gloock','Fraunces'],
  script: ['Dancing Script','Pacifico','Great Vibes','Caveat','Sacramento','Satisfy','Allura','Parisienne','Cookie','Alex Brush','Courgette','Yellowtail','Kaushan Script','Marck Script','Tangerine','Petit Formal Script','Italianno','Mrs Saint Delafield','Herr Von Muellerhoff','Rouge Script','Pinyon Script','Qwigley','Damion','Norican','Kalam','Patrick Hand','Shadows Into Light','Indie Flower','Gloria Hallelujah','Architects Daughter'],
  display: ['Bebas Neue','Anton','Oswald','Archivo Black','Abril Fatface','Lobster','Fredoka','Bungee','Alfa Slab One','Righteous','Staatliches','Black Ops One','Monoton','Press Start 2P','Russo One','Audiowide','Orbitron','Bowlby One SC','Rammetto One','Titan One','Lilita One','Luckiest Guy','Baloo 2','Concert One','Chewy','Permanent Marker','Bangers','Ultra','Modak','Fascinate'],
  delicate: ['Comfortaa','Josefin Sans','Poiret One','Questrial','Tenor Sans','Ysabeau','Josefin Slab','Marcellus','Cormorant','Forum','Didact Gothic','Gruppo','Gilda Display','Belleza','Encode Sans','M PLUS Rounded 1c','Sulphur Point','Chakra Petch','Syncopate'],
  youth: ['Fredoka','Baloo 2','Sniglet','Chewy','Bubblegum Sans','Grandstander','Schoolbell','Comic Neue','Short Stack','Coming Soon','Mali','Pangolin','Itim','Handlee','Gaegu','Neucha','Patrick Hand SC'],
  tech: ['Orbitron','Audiowide','Chakra Petch','Rajdhani','Exo 2','Oxanium','Michroma','Syncopate','Quantico','Tomorrow','Aldrich','Share Tech','Share Tech Mono','Space Mono','JetBrains Mono','IBM Plex Mono','Source Code Pro','Roboto Mono'],
  editorial: ['Bodoni Moda','Playfair Display','Cormorant Garamond','Prata','DM Serif Display','Gloock','Libre Caslon Display','Italiana','Instrument Serif','Yeseva One','Abril Fatface','Lora','Fraunces','Vidaloka'],
  mono: ['Roboto Mono','Space Mono','JetBrains Mono','IBM Plex Mono','Source Code Pro','Ubuntu Mono','Inconsolata','Fira Mono','Fira Code','Anonymous Pro','Courier Prime','Azeret Mono','DM Mono','Noto Sans Mono'],
};

function fontId(family: string) {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const fontsById = new Map<string, { id: string; family: string; categories: VybeFontCategory[]; weights: number[] }>();
for (const [category, families] of Object.entries(fontGroups) as [VybeFontCategory, string[]][]) {
  for (const family of families) {
    const id = fontId(family);
    const current = fontsById.get(id);
    if (current) current.categories.push(category);
    else fontsById.set(id, { id, family, categories: [category], weights: [400] });
  }
}

export const VYBE_FONTS = [...fontsById.values()];
export const VYBE_FONT_IDS = VYBE_FONTS.map((font) => font.id);
const fontById = new Map(VYBE_FONTS.map((font) => [font.id, font]));

const legacyFontIds: Record<string, string> = {
  DEFAULT: VYBE_DEFAULT_FONT_ID,
  MODERN: 'inter',
  ELEGANT: 'playfair-display',
  EDITORIAL: 'cormorant-garamond',
  SERIF: 'lora',
  SCRIPT: 'dancing-script',
};

export function normalizeVybeFontId(value: unknown): string {
  if (typeof value !== 'string') return VYBE_DEFAULT_FONT_ID;
  const normalized = value.trim();
  return legacyFontIds[normalized.toUpperCase()] ?? (fontById.has(normalized.toLowerCase()) ? normalized.toLowerCase() : VYBE_DEFAULT_FONT_ID);
}

export function getVybeFont(value: unknown) {
  const id = normalizeVybeFontId(value);
  return id === VYBE_DEFAULT_FONT_ID ? null : fontById.get(id) ?? null;
}

export function isAllowedVybeFont(value: unknown): value is string {
  return typeof value === 'string' && (value === VYBE_DEFAULT_FONT_ID || fontById.has(value) || Object.hasOwn(legacyFontIds, value.toUpperCase()));
}

export function getVybeFontFamily(value: unknown) {
  return getVybeFont(value)?.family ?? null;
}

export function getVybeFontCategories(category: VybeFontCategory) {
  return fontGroups[category].map((family) => fontById.get(fontId(family))!).filter(Boolean);
}
