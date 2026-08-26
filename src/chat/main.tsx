import { createRoot } from "react-dom/client";
import { App } from "./App";
import { refreshConfiguredProviders } from "./lib/models";
import { pen } from "./lib/pen";
import { loadSettings } from "./lib/storage";
import { applyTheme } from "./lib/theme";

void Promise.all([
  pen.init(),
  refreshConfiguredProviders(),
  loadSettings().then((s) => applyTheme(s.theme)),
]).finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
