const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("demo", {
  canvasReady: () => ipcRenderer.invoke("demo:canvas-ready"),
  onCanvasStatus: (callback) => {
    ipcRenderer.on("demo:canvas-status", (_event, ready) => callback(ready));
  },
  mcpSchema: () => ipcRenderer.invoke("demo:mcp-schema"),
  mcpToolCall: (name, args) => ipcRenderer.invoke("demo:mcp-tool-call", name, args),
  currentFile: () => ipcRenderer.invoke("demo:current-file"),
  openFile: () => ipcRenderer.invoke("demo:open-file"),
  newFile: () => ipcRenderer.invoke("demo:new-file"),
  onFileChanged: (callback) => {
    ipcRenderer.on("demo:file-changed", (_event, file) => callback(file));
  },
});
