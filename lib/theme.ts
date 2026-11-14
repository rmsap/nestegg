export const defaultPrimaryColor = "#245e49";

export function parsePrimaryColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

export function primaryColor(value: unknown) {
  return parsePrimaryColor(value) ?? defaultPrimaryColor;
}

function rgb(color: string) {
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
}

function luminance(rgb: number[]) {
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function themeVariables(value: string) {
  const color = primaryColor(value);
  const channels = rgb(color);
  const light = luminance(channels);
  const whiteContrast = 1.05 / (light + 0.05);
  const blackContrast = (light + 0.05) / 0.05;
  let accent = channels;
  // Darken along the selected hue until the accent works on pale surfaces.
  for (let shade = 95; 1.05 / (luminance(accent) + 0.05) < 7; shade -= 5) {
    accent = channels.map((channel) => Math.round(channel * shade / 100));
  }
  const accentColor = "#" + accent.map((channel) => channel.toString(16).padStart(2, "0")).join("");
  return {
    "--theme-primary": color,
    "--theme-on-primary": whiteContrast >= blackContrast ? "#ffffff" : "#000000",
    "--theme-primary-border": whiteContrast >= 3.5 ? color : accentColor,
    "--theme-accent-strong": accentColor,
  };
}
