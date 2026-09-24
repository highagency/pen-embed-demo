const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  WebContentsView,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { PenCapturer } = require("@pen.dev/sdk/electron");

const EDITOR_URL = "http://localhost:3002/new?embed";
const DOCUMENTS_DIR = path.join(__dirname, "documents");
const FILE_NAME = "untitled.pen";
const SIDEBAR_WIDTH = 400;
const BROWSER_START_URL = "https://example.com";
const BROWSER_PANEL_HEIGHT = 128;
const REQUEST_TIMEOUT_MS = 120_000;

// DocumentSaveResult.Saved in @ha/shared.
const SAVE_RESULT_SAVED = 0;

const DEFAULT_CONTENT = JSON.stringify({
  version: "2.6",
  children: [
    {
      type: "frame",
      id: "bi8Au",
      x: 0,
      y: 0,
      name: "Frame",
      clip: true,
      width: 800,
      height: 600,
      fill: "#FFFFFF",
      layout: "none",
    },
  ],
});

let win;
let view;
let browserWin;
let browserPage;
let capturer;
let bridgePort;
let connectTimer;
let canvasReady = false;
let requestCounter = 0;
const pendingRequests = new Map();
let currentFile = path.join(DOCUMENTS_DIR, FILE_NAME);

function fileInfo() {
  return { name: path.basename(currentFile), path: currentFile };
}

function setCurrentFile(filePath) {
  currentFile = filePath;
  if (win && !win.isDestroyed()) {
    win.webContents.send("demo:file-changed", fileInfo());
  }
  loadEditor();
}

function setCanvasReady(ready) {
  canvasReady = ready;
  if (win && !win.isDestroyed()) {
    win.webContents.send("demo:canvas-status", ready);
  }
}

function rejectPendingRequests(reason) {
  for (const { reject, timer } of pendingRequests.values()) {
    clearTimeout(timer);
    reject(new Error(reason));
  }
  pendingRequests.clear();
}

// Embedder -> editor requests (the bridge's MCP surface: get-mcp-schema and
// mcp-tool-call).
function bridgeRequest(method, payload) {
  if (!canvasReady || !bridgePort) {
    return Promise.reject(new Error("The canvas is not connected yet."));
  }
  const id = `demo-${++requestCounter}`;
  const port = bridgePort;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`request '${method}' timed out`));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(id, { resolve, reject, timer });
    port.postMessage({ kind: "request", id, method, payload });
  });
}

function assetPath(key) {
  const dir = path.dirname(currentFile);
  const resolved = path.resolve("/", key);
  if (!resolved.startsWith(dir + path.sep)) {
    throw new Error(`Asset outside the document folder: ${key}`);
  }
  return resolved;
}

async function handleStorageRequest(method, payload) {
  const filePath = currentFile;

  switch (method) {
    case "storage-load": {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      let content;
      try {
        content = await fs.readFile(filePath, "utf8");
      } catch {
        content = DEFAULT_CONTENT;
        await fs.writeFile(filePath, content);
      }
      const stat = await fs.stat(filePath);
      return {
        filePath: path.basename(filePath),
        content,
        updatedAt: stat.mtimeMs,
      };
    }

    case "storage-write": {
      await fs.writeFile(filePath, payload.content);
      return SAVE_RESULT_SAVED;
    }

    case "storage-read-asset": {
      try {
        const data = await fs.readFile(assetPath(payload.path));
        return new Uint8Array(data);
      } catch {
        return undefined;
      }
    }

    case "storage-write-asset": {
      const target = assetPath(payload.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(payload.data));
      return undefined;
    }

    case "storage-has-asset": {
      try {
        await fs.access(assetPath(payload.path));
        return true;
      } catch {
        return false;
      }
    }

    default:
      throw new Error(`Unsupported request: ${method}`);
  }
}

function stopConnecting() {
  if (connectTimer) {
    clearInterval(connectTimer);
    connectTimer = undefined;
  }
  if (bridgePort) {
    bridgePort.close();
    bridgePort = undefined;
  }
  rejectPendingRequests("The canvas connection was closed.");
  setCanvasReady(false);
}

// The editor page only starts listening once its client bundle is up, so keep
// re-sending pen:connect (a fresh channel each attempt) until it acks with
// { kind: "ready" }.
function startConnecting() {
  stopConnecting();

  const attempt = () => {
    bridgePort?.close();

    const { port1, port2 } = new MessageChannelMain();
    bridgePort = port1;

    port1.on("message", (event) => {
      const message = event.data;

      if (message?.kind === "ready") {
        if (connectTimer) {
          clearInterval(connectTimer);
          connectTimer = undefined;
        }
        console.log("[demo] connected to editor");
        setCanvasReady(true);
        bridgeRequest("get-mcp-schema").then(
          (schema) =>
            console.log(
              `[demo] canvas tools: ${(schema?.tools ?? [])
                .map((tool) => tool.name)
                .join(", ")}`,
            ),
          (error) => console.warn(`[demo] get-mcp-schema failed:`, error),
        );
        return;
      }

      if (message?.kind === "response") {
        const entry = pendingRequests.get(message.id);
        if (!entry) {
          return;
        }
        pendingRequests.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) {
          entry.reject(
            new Error(`${message.error.code}: ${message.error.message}`),
          );
        } else {
          entry.resolve(message.payload);
        }
        return;
      }

      if (message?.kind === "request") {
        handleStorageRequest(message.method, message.payload).then(
          (payload) =>
            port1.postMessage({ kind: "response", id: message.id, payload }),
          (error) =>
            port1.postMessage({
              kind: "response",
              id: message.id,
              error: { code: "ERROR", message: String(error.message ?? error) },
            }),
        );
      }
    });
    port1.start();

    view.webContents.postMessage(
      "pen-connect",
      { theme: "dark", fileURI: pathToFileURL(currentFile).href },
      [port2],
    );
  };

  attempt();
  connectTimer = setInterval(attempt, 500);
}

function layoutView() {
  const { width, height } = win.getContentBounds();
  view.setBounds({
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(0, width - SIDEBAR_WIDTH),
    height,
  });
}

function browserStatus(text) {
  if (browserWin && !browserWin.isDestroyed()) {
    browserWin.webContents.send("demo:browser-status", text);
  }
}

async function importSelection() {
  if (!capturer) {
    return;
  }
  if (!canvasReady) {
    browserStatus("The canvas is not connected yet.");
    return;
  }
  try {
    const payload = await capturer.capture({
      onProgress: (fraction) =>
        browserStatus(`Capturing… ${Math.round(fraction * 100)}%`),
    });
    browserStatus("Importing into the canvas…");
    const { success } = await bridgeRequest("browser-import", payload);
    browserStatus(
      success
        ? "Imported into the canvas."
        : "The canvas could not import the capture.",
    );
  } catch (error) {
    browserStatus(`Import failed: ${error.message ?? error}`);
  }
}

function openBrowserWindow() {
  if (browserWin && !browserWin.isDestroyed()) {
    browserWin.focus();
    return;
  }
  browserWin = new BrowserWindow({
    width: 1000,
    height: 800,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload-browser.js"),
    },
  });
  const pageView = new WebContentsView();
  browserPage = pageView;
  browserWin.contentView.addChildView(pageView);
  const layoutPage = () => {
    const { width, height } = browserWin.getContentBounds();
    pageView.setBounds({
      x: 0,
      y: BROWSER_PANEL_HEIGHT,
      width,
      height: Math.max(0, height - BROWSER_PANEL_HEIGHT),
    });
  };
  browserWin.on("resize", layoutPage);
  layoutPage();
  browserWin.loadFile("browser.html");
  pageView.webContents.loadURL(BROWSER_START_URL);

  capturer = new PenCapturer(pageView.webContents, { screenshots: true });
  capturer.on("picker", (state) => {
    if (browserWin && !browserWin.isDestroyed()) {
      browserWin.webContents.send("demo:browser-picker", state);
    }
  });
  capturer.on("action", (action) => {
    if (action === "import") {
      void importSelection();
    }
  });

  browserWin.on("closed", () => {
    capturer.dispose();
    capturer = undefined;
    browserPage = undefined;
    browserWin = undefined;
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload-chat.js"),
      // The chat sidebar is a file:// page calling provider APIs directly;
      // without this every provider request dies on CORS.
      webSecurity: false,
    },
  });

  view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload-editor.js"),
    },
  });
  win.contentView.addChildView(view);

  win.on("resize", layoutView);
  layoutView();

  await win.loadFile("index.html");

  loadEditor();
}

function loadEditor() {
  stopConnecting();
  view.webContents.once("did-finish-load", () => startConnecting());
  view.webContents.loadURL(EDITOR_URL);
}

ipcMain.handle("demo:canvas-ready", () => canvasReady);

ipcMain.handle("demo:current-file", () => fileInfo());

ipcMain.handle("demo:open-file", async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Pen documents", extensions: ["pen"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return undefined;
  }
  setCurrentFile(result.filePaths[0]);
  return fileInfo();
});

ipcMain.handle("demo:new-file", async () => {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: "untitled.pen",
    filters: [{ name: "Pen documents", extensions: ["pen"] }],
  });
  if (result.canceled || !result.filePath) {
    return undefined;
  }
  const filePath = result.filePath.endsWith(".pen")
    ? result.filePath
    : `${result.filePath}.pen`;
  await fs.writeFile(filePath, DEFAULT_CONTENT);
  setCurrentFile(filePath);
  return fileInfo();
});

ipcMain.handle("demo:mcp-schema", () => bridgeRequest("get-mcp-schema"));

ipcMain.handle("demo:mcp-tool-call", (_event, name, args) =>
  bridgeRequest("mcp-tool-call", {
    name: String(name),
    arguments: args && typeof args === "object" ? args : {},
  }),
);

ipcMain.on("demo:open-browser", openBrowserWindow);

ipcMain.on("demo:browser-navigate", (_event, url) => {
  void capturer?.endPicking();
  browserPage?.webContents.loadURL(url);
});

ipcMain.on("demo:browser-pick", () => {
  if (!capturer) {
    return;
  }
  if (capturer.picker) {
    void capturer.endPicking();
  } else {
    capturer.startPicking();
  }
});

ipcMain.handle("demo:browser-select", async (_event, selector) => {
  const pick = await capturer?.select(String(selector));
  browserStatus(
    pick ? `Selected ${pick.element.label}.` : `No match for ${selector}.`,
  );
  return pick !== undefined;
});

ipcMain.on("demo:browser-select-path", (_event, index) => {
  void capturer?.selectPathEntry(index);
});

ipcMain.on("demo:browser-hover", (_event, selector) => {
  void capturer?.hover(selector ?? undefined);
});

ipcMain.on("demo:browser-hover-path", (_event, index) => {
  const pick = capturer?.picker?.pick;
  const selectorOf = pick?.element.selector;
  const steps = selectorOf && index !== null ? pick.pathIndex - index : -1;
  let selector;
  if (steps === 0) {
    selector = selectorOf;
  } else if (steps > 0) {
    selector = `*:has(> ${"* > ".repeat(steps - 1)}${selectorOf})`;
  }
  void capturer?.hover(selector);
});

ipcMain.on("demo:browser-import", () => void importSelection());

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
