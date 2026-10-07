// Categorical hues in a fixed order (the dataviz reference palette, validated
// for both themes). Types take them alphabetically, so a type keeps its colour
// in the graph and the table however either is filtered; a ninth type and
// beyond share a neutral grey.
const HUES = {
  light: [
    "#2a78d6",
    "#eb6834",
    "#1baf7a",
    "#eda100",
    "#e87ba4",
    "#008300",
    "#4a3aa7",
    "#e34948",
  ],
  dark: [
    "#3987e5",
    "#d95926",
    "#199e70",
    "#c98500",
    "#d55181",
    "#008300",
    "#9085e9",
    "#e66767",
  ],
};
export const isDark = () => {
  const theme = document.documentElement.dataset.theme;
  return theme
    ? theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
};
// `types` is every type name, sorted.
export function typeHue(types: string[], type: string) {
  const i = types.indexOf(type),
    hues = isDark() ? HUES.dark : HUES.light;
  return i >= 0 && i < hues.length ? hues[i] : "";
}
