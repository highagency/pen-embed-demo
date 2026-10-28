const { ipcRenderer } = require("electron");

// Forward the MessagePort from the main process into the page's main world,
// where the web editor's embed bridge listens for pen:connect.
ipcRenderer.on("pen-connect", (event, data) => {
  window.postMessage({ type: "pen:connect", ...data }, "*", event.ports);
});

// The bridge posts pen:ready to window.parent, which is this window in a
// WebContentsView, whenever it starts listening for pen:connect.
window.addEventListener("message", (event) => {
  if (event.data?.type === "pen:ready") {
    ipcRenderer.send("demo:editor-bridge-ready");
  }
});
