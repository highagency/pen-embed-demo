const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  nativeTheme,
  shell,
  WebContentsView,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { fileURLToPath, pathToFileURL } = require("node:url");
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
// DocumentSaveResult.NothingToSave in @ha/shared.
const SAVE_RESULT_NOTHING_TO_SAVE = 1;
// DocumentKind.File / .Managed, DashboardPreviewKind.None and
// DashboardRemoval.Delete in @ha/shared, for the editor's dashboard.
const DOCUMENT_KIND_FILE = 0;
const DOCUMENT_KIND_MANAGED = 1;
const PREVIEW_KIND_NONE = 0;
const REMOVAL_DELETE = 1;
const PREVIEWS_DIR = path.join(DOCUMENTS_DIR, ".previews");
const RECENTS_FILE = path.join(DOCUMENTS_DIR, ".recents.json");

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

async function handleEditorRequest(method, payload) {
  const filePath = currentFile;

  switch (method) {
    case "storage-load": {
      await recordOpened(filePath);
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

    // The editor's dashboard shows documents/ as its drafts and every file
    // opened here as its recents.
    case "documents-list": {
      return listDocuments();
    }

    case "documents-previews": {
      const previews = {};
      for (const uri of payload.uris) {
        try {
          previews[uri] = new Uint8Array(
            await fs.readFile(previewPath(fileURLToPath(uri))),
          );
        } catch {
          // No preview saved yet.
        }
      }
      return previews;
    }

    case "documents-save-preview": {
      await fs.mkdir(PREVIEWS_DIR, { recursive: true });
      await fs.writeFile(previewPath(filePath), Buffer.from(payload.image));
      return undefined;
    }

    case "documents-open": {
      const target = fileURLToPath(payload.uri);
      if (!target.endsWith(".pen")) {
        throw new Error(`Not a .pen file: ${payload.uri}`);
      }

      await saveBeforeLeaving();
      setCurrentFile(target);
      return undefined;
    }

    case "documents-new": {
      await saveBeforeLeaving();
      setCurrentFile(await createUntitledDocument());
      return undefined;
    }

    // Deleting only touches drafts; removing from recents works for any file.
    case "documents-remove": {
      const isDeleting = payload.removal === REMOVAL_DELETE;
      const recents = await loadRecents();
      const removed = [];
      for (const uri of payload.uris) {
        const target = fileURLToPath(uri);
        if (isDeleting) {
          if (!isDraft(target)) {
            continue;
          }

          await fs.rm(target, { force: true });
          await fs.rm(previewPath(target), { force: true });
        }

        delete recents[uri];
        removed.push(uri);
      }
      await saveRecents(recents);

      if (isDeleting && removed.includes(pathToFileURL(filePath).href)) {
        setCurrentFile(await createUntitledDocument());
      }
      return removed;
    }

    // Only sent because pen:connect lists "open-link" in capabilities.
    case "open-link": {
      const url = new URL(payload.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error(`Not a web link: ${payload.url}`);
      }

      await shell.openExternal(url.href);
      return undefined;
    }

    default:
      throw new Error(`Unsupported request: ${method}`);
  }
}

function isDraft(filePath) {
  return path.dirname(filePath) === DOCUMENTS_DIR && filePath.endsWith(".pen");
}

// Recents map each opened document's URI to when it was last opened.
async function loadRecents() {
  try {
    return JSON.parse(await fs.readFile(RECENTS_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function saveRecents(recents) {
  await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
  await fs.writeFile(RECENTS_FILE, JSON.stringify(recents, null, 2));
}

async function recordOpened(filePath) {
  const recents = await loadRecents();
  recents[pathToFileURL(filePath).href] = Date.now();
  await saveRecents(recents);
}

async function listDocuments() {
  await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
  const recents = await loadRecents();
  const drafts = (await fs.readdir(DOCUMENTS_DIR))
    .map((name) => path.join(DOCUMENTS_DIR, name))
    .filter(isDraft);
  const uris = new Set([
    ...Object.keys(recents),
    ...drafts.map((filePath) => pathToFileURL(filePath).href),
  ]);

  const documents = await Promise.all(
    [...uris].map(async (uri) => {
      const filePath = fileURLToPath(uri);

      // Moved or deleted files stay in the recents and come back with the file.
      const stat = await fs.stat(filePath).catch(() => undefined);
      if (stat == null) {
        return undefined;
      }

      return {
        uri,
        kind: isDraft(filePath) ? DOCUMENT_KIND_MANAGED : DOCUMENT_KIND_FILE,
        name: path.basename(filePath),
        preview: { kind: PREVIEW_KIND_NONE },
        timestamps: {
          createdAt: stat.birthtimeMs,
          lastEditedAt: stat.mtimeMs,
          lastOpenedAt: recents[uri],
        },
      };
    }),
  );
  return documents.filter((document) => document != null);
}

// Previews live in documents/.previews, named after a hash of the file's
// path, so opening a file from elsewhere doesn't write next to it.
function previewPath(filePath) {
  const id = crypto.createHash("sha1").update(filePath).digest("hex");
  return path.join(PREVIEWS_DIR, `${id}.png`);
}

async function createUntitledDocument() {
  await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
  const names = new Set(await fs.readdir(DOCUMENTS_DIR));
  let name = FILE_NAME;
  for (let n = 2; names.has(name); n++) {
    name = `untitled-${n}.pen`;
  }

  const filePath = path.join(DOCUMENTS_DIR, name);
  await fs.writeFile(filePath, DEFAULT_CONTENT);
  return filePath;
}

// Switching documents reloads the editor, so flush its edits first and stay
// on the current document when that fails.
async function saveBeforeLeaving() {
  // A canvas that isn't connected has no edits to flush, and refusing would
  // strand the user on it.
  if (!canvasReady) {
    return;
  }

  const result = await bridgeRequest("save");
  if (result !== SAVE_RESULT_SAVED && result !== SAVE_RESULT_NOTHING_TO_SAVE) {
    throw new Error(`The open document could not be saved (result ${result}).`);
  }
}

function editorTheme() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function disconnect() {
  if (bridgePort) {
    bridgePort.close();
    bridgePort = undefined;
  }
  rejectPendingRequests("The canvas connection was closed.");
  setCanvasReady(false);
}

// Hands the editor a fresh channel with pen:connect. Runs when the page has
// loaded and again on every pen:ready, which the bridge posts each time it
// starts listening. The bridge adopts the newest port, so an extra connect is
// harmless.
function connect() {
  disconnect();

  const { port1, port2 } = new MessageChannelMain();
  bridgePort = port1;

  port1.on("message", (event) => {
    const message = event.data;

    if (message?.kind === "ready") {
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

    if (message?.kind === "error") {
      console.warn(`[demo] editor rejected connect: ${message.code}: ${message.message}`);
      return;
    }

    if (message?.kind === "notification" && message.method === "selection-changed") {
      if (win && !win.isDestroyed()) {
        win.webContents.send("demo:selection-changed", message.payload);
      }
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
      handleEditorRequest(message.method, message.payload).then(
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
    {
      theme: editorTheme(),
      fileURI: pathToFileURL(currentFile).href,
      // Label and RGB (0–1) color of the cursor shown while the agent's
      // tool calls edit the canvas.
      clientName: "Agent",
      cursorColor: [0 / 255, 214 / 255, 143 / 255],
      capabilities: ["open-link"],
    },
    [port2],
  );
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
  disconnect();
  view.webContents.once("did-finish-load", () => connect());
  view.webContents.loadURL(EDITOR_URL);
}

nativeTheme.themeSource = "dark";

nativeTheme.on("updated", () => {
  bridgePort?.postMessage({
    kind: "notification",
    method: "color-theme-changed",
    payload: { theme: editorTheme() },
  });
});

ipcMain.on("demo:set-theme", (_event, theme) => {
  nativeTheme.themeSource = theme;
});

ipcMain.on("demo:editor-bridge-ready", () => connect());

ipcMain.handle("demo:canvas-ready", () => canvasReady);

ipcMain.handle("demo:current-file", () => fileInfo());

// The sidebar's Open and New also switch documents, so they save first and
// keep the current document, with an error box, when that fails.
async function canLeaveDocument() {
  try {
    await saveBeforeLeaving();
    return true;
  } catch (error) {
    dialog.showErrorBox(
      "Couldn't save the open document",
      String(error.message ?? error),
    );
    return false;
  }
}

ipcMain.handle("demo:open-file", async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Pen documents", extensions: ["pen"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return undefined;
  }
  if (!(await canLeaveDocument())) {
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
  if (!(await canLeaveDocument())) {
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
