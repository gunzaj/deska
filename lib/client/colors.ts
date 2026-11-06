// GitHub Projects single-select colours (an enum) mapped to a palette that
// sits well on the app surfaces in both themes. Option *names* are never
// hardcoded; only GitHub's fixed colour enum is.
const PROJECT_COLORS: Record<string, string> = {
  GRAY: "#8b9097",
  BLUE: "#4f86e8",
  GREEN: "#36ab66",
  YELLOW: "#d9a21b",
  ORANGE: "#e5793a",
  RED: "#e0525c",
  PINK: "#e2669e",
  PURPLE: "#8c6fe6",
};

export function optionColor(color: string | null | undefined): string {
  if (!color) return PROJECT_COLORS.GRAY!;
  const upper = color.toUpperCase();
  if (PROJECT_COLORS[upper]) return PROJECT_COLORS[upper]!;
  // Labels carry a hex without '#'.
  if (/^[0-9a-f]{6}$/i.test(color)) return `#${color}`;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  return PROJECT_COLORS.GRAY!;
}

/**
 * Deterministic colour for things without one (users). Avatars put white
 * initials on it, so the lightness keeps every hue at 4.5:1 or better.
 */
export function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 32%)`;
}
