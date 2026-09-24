const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("demo", {
  browser: {
    navigate: (url) => ipcRenderer.send("demo:browser-navigate", url),
    pick: () => ipcRenderer.send("demo:browser-pick"),
    select: (selector) => ipcRenderer.invoke("demo:browser-select", selector),
    selectPath: (index) => ipcRenderer.send("demo:browser-select-path", index),
    hover: (selector) => ipcRenderer.send("demo:browser-hover", selector),
    hoverPath: (index) => ipcRenderer.send("demo:browser-hover-path", index),
    import: () => ipcRenderer.send("demo:browser-import"),
    onPicker: (callback) => {
      ipcRenderer.on("demo:browser-picker", (_event, state) => callback(state));
    },
    onStatus: (callback) => {
      ipcRenderer.on("demo:browser-status", (_event, text) => callback(text));
    },
  },
});
