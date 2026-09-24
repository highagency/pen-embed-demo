import { createRoot } from "react-dom/client";
import { loadSettings } from "../chat/lib/storage";
import { applyTheme } from "../chat/lib/theme";
import { browser } from "./browser";
import { BrowserPanel } from "./BrowserPanel";

void loadSettings()
  .then((s) => applyTheme(s.theme))
  .finally(() => {
    browser.init();
    createRoot(document.getElementById("browser-root")!).render(<BrowserPanel />);
  });
