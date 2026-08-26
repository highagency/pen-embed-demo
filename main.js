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

const EDITOR_URL = "http://localhost:3002/new?embed=true";
const DOCUMENTS_DIR = path.join(__dirname, "documents");
const FILE_NAME = "untitled.pen";
const SIDEBAR_WIDTH = 400;
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

// Assets live in an assets/ folder next to the current .pen file.
function assetPath(relativePath) {
  const dir = path.dirname(currentFile);
  const resolved = path.normalize(path.join(dir, "assets", relativePath));
  if (!resolved.startsWith(dir + path.sep)) {
    throw new Error(`Invalid asset path: ${relativePath}`);
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

    view.webContents.postMessage("pen-connect", { theme: "dark" }, [port2]);
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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
