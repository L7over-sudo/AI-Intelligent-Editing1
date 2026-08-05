export interface AssetRenderContext {
  accentColor: string;
  label: string;
  emphasis: boolean;
}

export type SvgAssetRenderer = (context: AssetRenderContext) => string;

const line = (path: string) =>
  `<path d="${path}" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;

const person = (arms: string, legs = "M0 38L-26 78M0 38L28 78") =>
  [
    '<circle cx="0" cy="-48" r="25" fill="white" stroke="currentColor" stroke-width="7"/>',
    line("M0 -22V38"),
    line(arms),
    line(legs),
  ].join("");

export const SVG_ASSETS: Record<string, SvgAssetRenderer> = {
  "person-standing": () => person("M0 0L-38 24M0 0L38 24"),
  "person-pointing": () => person("M0 0L-35 20M0 0L58 -18"),
  "person-thinking": () =>
    person("M0 0L-32 28M0 0L28 -36M28 -36L15 -50"),
  "person-running": () =>
    person("M0 0L-42 -24M0 0L42 18", "M0 38L-40 62M0 38L36 75"),
  "person-celebrating": () =>
    person("M0 0L-42 -45M0 0L42 -45", "M0 38L-30 78M0 38L30 78"),
  desk: () =>
    `${line("M-62 0H62M-50 0V64M50 0V64")}<rect x="-42" y="-32" width="84" height="32" rx="5" fill="white" stroke="currentColor" stroke-width="6"/>`,
  laptop: () =>
    '<rect x="-45" y="-38" width="90" height="62" rx="6" fill="white" stroke="currentColor" stroke-width="6"/><path d="M-62 34H62L48 48H-48Z" fill="white" stroke="currentColor" stroke-width="6"/>',
  phone: () =>
    '<rect x="-27" y="-48" width="54" height="96" rx="9" fill="white" stroke="currentColor" stroke-width="6"/><circle cx="0" cy="34" r="4" fill="currentColor"/>',
  document: ({ accentColor, emphasis }) =>
    `<path d="M-38 -52H18L42 -28V52H-38Z" fill="white" stroke="currentColor" stroke-width="6"/><path d="M18 -52V-28H42M-20 -12H23M-20 8H23M-20 28H10" stroke="${emphasis ? accentColor : "currentColor"}" stroke-width="6" stroke-linecap="round"/>`,
  arrow: ({ accentColor }) =>
    `<path d="M-58 0H48M22 -26L50 0L22 26" fill="none" stroke="${accentColor}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`,
  "speech-bubble": ({ accentColor, label }) =>
    `<path d="M-62 -42H62V28H5L-22 52L-16 28H-62Z" fill="white" stroke="currentColor" stroke-width="6"/><text x="0" y="2" text-anchor="middle" font-size="22" font-weight="700" fill="${accentColor}">${label}</text>`,
  "question-mark": ({ accentColor }) =>
    `<text x="0" y="32" text-anchor="middle" font-size="112" font-family="Arial" font-weight="900" fill="${accentColor}">?</text>`,
  clock: ({ accentColor }) =>
    `<circle r="52" fill="white" stroke="currentColor" stroke-width="7"/><path d="M0 -38V0L27 18" fill="none" stroke="${accentColor}" stroke-width="8" stroke-linecap="round"/>`,
  chart: ({ accentColor }) =>
    `${line("M-55 -48V50H60")}<path d="M-42 32L-12 5L12 18L50 -30" fill="none" stroke="${accentColor}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,
  door: ({ accentColor }) =>
    `<path d="M-42 58V-58H42V58" fill="white" stroke="currentColor" stroke-width="7"/><circle cx="22" cy="2" r="6" fill="${accentColor}"/>`,
};

