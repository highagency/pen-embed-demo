const { ipcRenderer } = require("electron");

// Forward the MessagePort from the main process into the page's main world,
// where the web editor's embed bridge listens for pen:connect.
ipcRenderer.on("pen-connect", (event, data) => {
  window.postMessage({ type: "pen:connect", ...data }, "*", event.ports);
});
