import pc from 'picocolors';

// Small palette so the CLI has a consistent, colorful look (OpenClaw-style).
export const theme = {
  brand: (s: string) => pc.cyan(pc.bold(s)),
  accent: (s: string) => pc.magenta(s),
  label: (s: string) => pc.bold(pc.white(s)),
  ok: (s: string) => pc.green(s),
  warn: (s: string) => pc.yellow(s),
  muted: (s: string) => pc.dim(s),
  key: (s: string) => pc.cyan(s),
  value: (s: string) => pc.white(s),
  cmd: (s: string) => pc.green(s),
};

// MDK brand orange (256-color 208), matching the logo. Falls back to plain
// text when colors are unsupported (e.g. NO_COLOR or a non-TTY pipe).
const orange = (s: string): string =>
  pc.isColorSupported ? `\x1b[38;5;208m${s}\x1b[39m` : s;

// A little badge used in intros, e.g. " MDK " on a colored background.
export function badge(label: string): string {
  return pc.bgCyan(pc.black(pc.bold(` ${label} `)));
}

const MDK_ART = [
  '███╗   ███╗██████╗ ██╗  ██╗',
  '████╗ ████║██╔══██╗██║ ██╔╝',
  '██╔████╔██║██║  ██║█████╔╝ ',
  '██║╚██╔╝██║██║  ██║██╔═██╗ ',
  '██║ ╚═╝ ██║██████╔╝██║  ██╗',
  '╚═╝     ╚═╝╚═════╝ ╚═╝  ╚═╝',
];

/** Big orange "MDK" logo with a "tether." tagline, for the onboarding header. */
export function banner(): string {
  const art = MDK_ART.map((line) => orange(pc.bold(line))).join('\n');
  const tagline = `${' '.repeat(19)}${orange('tether.')}`;
  return `\n${art}\n${tagline}\n`;
}

/** Aligned key/value block (keys padded to a common width, then colored). */
export function kvBlock(rows: Array<[string, string]>): string {
  const width = Math.max(0, ...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${theme.key(k.padEnd(width))}   ${v}`).join('\n');
}

/** Aligned command list; a comment (rendered as `# ...`) is optional. */
export function cmdBlock(rows: Array<[string, string?]>): string {
  const width = Math.max(0, ...rows.map(([c]) => c.length));
  return rows
    .map(([c, comment]) =>
      comment ? `${theme.cmd(c.padEnd(width))}   ${theme.muted(`# ${comment}`)}` : theme.cmd(c),
    )
    .join('\n');
}

export const tick = pc.green('✔');
export const dot = pc.dim('•');
export const arrow = pc.dim('→');
