export type Theme = "dark" | "light" | "system";

export function applyTheme(theme: Theme | undefined) {
  document.documentElement.dataset.theme = theme ?? "dark";
}
