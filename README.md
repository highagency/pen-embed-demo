# pen-embed-demo (proposal)

<video src="video.mov" controls muted width="100%">
  <a href="video.mov">▶ demo video</a>
</video>

Electron app demonstrating embedding the pen.dev web editor through its embed
bridge, with a pi-agent chat sidebar that drives the canvas through the
bridge's MCP tools.

The main window hosts the chat sidebar (React + assistant-ui +
[pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core))
and a `WebContentsView` pointed at `http://localhost:3002/new?embed`.
The main process speaks the embed API described below; the chat agent picks
up the canvas tools automatically, streams, supports thinking levels,
tool-call inspection, history, and bring-your-own API keys (Anthropic,
OpenAI, Google, Moonshot, OpenRouter, and more) stored in `localStorage`.

- The top bar shows the open `.pen` file and can create a new one or open an
  existing one from disk (imported images and fonts land in `images/` and
  `fonts/` next to the file). Switching files saves the open one first, then
  reloads the editor and reconnects the bridge.
- The editor's dashboard lists the files in `documents/` as drafts and every
  file opened in the demo as recents, with previews.
- The canvas selection shows above the message box and is passed to the agent,
  so "make this blue" works.
- The editor follows the sidebar's theme setting, including the system
  appearance.
- Links in the editor open in the default browser.

## Browser import

The globe button in the sidebar's top bar opens a browser window driven by
`@pen.dev/sdk/electron` (installed from npm).
Its strip has a URL bar, a Pick
button for the in-page crosshair, a CSS selector input that hovers its match
as you type, a clickable ancestor breadcrumb that hovers on mouseover, and a
read-out of the picked element's component name and styles. Import (or Enter
in the page) captures the selection and sends it to the canvas with the
bridge's `browser-import` request.

## Run

1. Serve the pen.dev web editor on `http://localhost:3002` (its Next.js dev
   server). To use another editor, change `EDITOR_URL` in `main.js`.

2. Start the demo:

   ```sh
   npm install
   npm start
   ```

3. Add an API key in the sidebar's Settings, then ask the agent to design
   something on the canvas.

`npm run dev` rebuilds the chat bundle on change.

If `npm start` fails with "Electron failed to install correctly", Electron's
download didn't unpack; this happens on very new Node versions. Use Node 22
LTS and reinstall.

## The `pen.dev` embed API

Loading `/new?embed` puts the editor in embed mode: it renders no local
document UI and expects the embedding page (the *embedder*) to supply the
document and talk to it over a `MessagePort`.

### Messages at a glance

- **Required:** the editor doesn't work without it.
- **Recommended:** the editor works, but a typical embedder feels broken
  without it, e.g. an agent can't act on the canvas or the dashboard is empty.
- **Optional:** adds a feature.

Requests the embedder doesn't support should be answered with an error
response; the editor degrades as noted.

| Phase | Message | Kind | Direction | Support | What it does |
| --- | --- | --- | --- | --- | --- |
| 1. Handshake | `pen:ready` | window message | editor → embedder | Required | The bridge is listening; answer with `pen:connect` |
| | `pen:connect` | window message | embedder → editor | Required | Hands over the port, document URI and options |
| | `error` | port | editor → embedder | Required | Only when the connect is rejected (`INVALID_FILE_URI`); the port closes |
| 2. Loading | `storage-load` | request | editor → embedder | Required | Returns the document; the editor shows nothing until it resolves |
| | `storage-read-asset` / `-has-asset` | request | editor → embedder | Required | Reads the document's images and fonts |
| | `ready` | port | editor → embedder | Required | The document has loaded; tools can be called |
| 3. While editing | `get-mcp-schema` | request | embedder → editor | Recommended | Lists the canvas's MCP tools, usually right after `ready` |
| | `documents-save-preview` | request | editor → embedder | Optional | A thumbnail of the open document, about 4 s after loading and edits; failures are ignored |
| | `selection-changed` | notification | editor → embedder | Optional | The canvas selection changed |
| | `mcp-tool-call` | request | embedder → editor | Recommended | Runs one MCP tool; the only way for the embedder, e.g. an agent, to act on the canvas |
| | `storage-write` | request | editor → embedder | Required | Persists the document, at most every 5 s after edits |
| | `storage-write-asset` | request | editor → embedder | Required | Stores an image or font the user added |
| | `color-theme-changed` | notification | embedder → editor | Optional | Switches the editor between light and dark |
| | `browser-import` | request | embedder → editor | Optional | Pastes a browser capture onto the canvas |
| | `open-link` | request | editor → embedder | Optional (capability) | Opens a link; sent only when `capabilities` lists it, otherwise the editor uses `window.open`. Effectively Recommended in hosts that block `window.open` |
| 4. Switching documents | `documents-list` | request | editor → embedder | Recommended | Fills the dashboard when it opens; the editor always shows its Dashboard button, and without this it stays empty |
| | `documents-previews` | request | editor → embedder | Optional | Thumbnails for the dashboard |
| | `documents-open` / `-new` / `-remove` | request | editor → embedder | Recommended | Dashboard actions; without them they fail |
| | `save` | request | embedder → editor | Recommended | Flushes pending edits; send it before switching, then reload the editor, which starts again at phase 1 |

### Wire format

Every message on the port is one of:

```ts
type BridgeMessage =
  | { kind: "ready" }                                       // editor → embedder, once the document has loaded
  | { kind: "error"; code: string; message: string }        // editor → embedder, rejected connect
  | { kind: "request"; id: string | number; method: string; payload?: unknown }
  | {
      kind: "response";
      id: string | number;                                  // echoes the request id
      payload?: unknown;
      error?: { code: string; message: string };            // set instead of payload on failure
    }
  | { kind: "notification"; method: string; payload?: unknown };  // no response
```

Requests flow in both directions; each must be answered with a `response`
carrying the same `id`. See `handleEditorRequest` in `main.js` for a
filesystem-backed reference implementation of the editor's requests.

### 1. Handshake

#### `pen:ready` → `pen:connect`

When its bridge starts listening, the editor posts `{ type: "pen:ready" }` to
`window.parent`. Answer it by posting a connect message into the editor's
window with one half of a `MessageChannel`:

```ts
interface ConnectMessage {
  type: "pen:connect";
  /** Absolute URI of the open document, e.g. `file:///Users/me/docs/untitled.pen`. */
  fileURI: string;
  /** Editor color scheme. Default: "dark". */
  theme?: "light" | "dark";
  /** Label of the cursor shown while `mcp-tool-call`s edit the canvas. Default: "Embed". */
  clientName?: string;
  /** That cursor's color as RGB in 0–1. Default: grey. */
  cursorColor?: [number, number, number];
  /**
   * Optional requests the embedder answers. Currently: "open-link". New:
   * older editors ignore it and fall back to `window.open`.
   */
  capabilities?: string[];
  /**
   * Who is embedding: { name, version?, host?, installId?, analyticsConsent? }.
   * The editor only acts on it for the pen.dev MCP app, for analytics.
   */
  embedder?: object;
}

const channel = new MessageChannel();
editorWindow.postMessage(
  {
    type: "pen:connect",
    fileURI: "file:///Users/me/docs/untitled.pen",
    theme: "dark",
    capabilities: ["open-link"],
  } satisfies ConnectMessage,
  "*",
  [channel.port2],
);
```

- The editor adopts the newest port and moves on to loading the document.
- `pen:ready` is posted again whenever the bridge restarts; connect again with
  a fresh channel each time.
- Every `pen:connect` restarts the editor's document load, so don't send one
  on a timer.

#### `error`

When `fileURI` is missing or not absolute, the editor answers
`{ kind: "error", code: "INVALID_FILE_URI", message }` and closes the port.

### 2. Loading

The embedder owns the document; the editor loads and persists it through
these requests.

#### `storage-load`

Called right after connecting; the editor renders nothing until it resolves.
Serve a default document on first load (`DEFAULT_CONTENT` in `main.js` is a
minimal valid `.pen`).

```ts
payload:  undefined
response: {
  filePath: string;   // display path, e.g. "untitled.pen"
  content: string;    // the .pen document as a JSON string
  updatedAt: number;  // last-modified, ms since epoch
}
```

#### `storage-read-asset` / `storage-has-asset`

Assets (e.g. images placed on the canvas) are keyed by an absolute path,
resolved next to the connect message's `fileURI` and written without its
leading slash: `Users/me/docs/images/photo.png` for
`file:///Users/me/docs/untitled.pen`.

```ts
// storage-read-asset
payload:  { path: string }
response: Uint8Array | undefined  // undefined when the asset does not exist

// storage-has-asset
payload:  { path: string }
response: boolean
```

#### `ready`

Once the document has loaded, the editor sends `{ kind: "ready" }` on the
port. Wait for it before calling tools.

### 3. While editing

These come in no fixed order, whenever the user or the embedder acts.

#### `get-mcp-schema` (embedder → editor)

Returns the canvas's tool list in MCP form. Currently: `execute`,
`get_app_state`, `get_style`, `read_skill`.

```ts
payload:  undefined
response: { tools: MCPToolSchema[] }

interface MCPToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema for `arguments`
  annotations?: { title?: string; readOnlyHint?: boolean; [key: string]: unknown };
}
```

#### `documents-save-preview` (editor → embedder)

A thumbnail of the open document, sent about 4 s after loading and after
edits, at most once a minute. `documents-previews` hands it back to the
dashboard.

```ts
payload:  { image: Uint8Array }  // PNG, 512 px
response: undefined              // failures are ignored
```

#### `selection-changed` (editor → embedder, notification)

```ts
payload: { nodes: { id: string; type: string; name?: string }[] }  // empty when nothing is selected
```

#### `mcp-tool-call` (embedder → editor)

Executes one tool and resolves with an MCP-style result. Edits show the
`clientName` / `cursorColor` cursor.

```ts
payload:  { name: string; arguments?: Record<string, unknown> }  // must match inputSchema
response: MCPToolResult

interface MCPToolResult {
  content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }  // data = base64
  )[];
  isError?: boolean;  // true when the tool ran but reported a failure
}
```

Feed the schemas to an LLM as tool definitions and proxy its tool calls
through `mcp-tool-call` — that is exactly what this demo's chat sidebar does
(`src/chat/lib/pen.ts`, `src/chat/lib/session.ts`). `execute` runs code
against the editor's own API; `get_app_state` documents that API.

#### `storage-write` (editor → embedder)

Sent by autosave, at most every 5 s after edits, and by `save`.

```ts
payload:  { fileURI: string; content: string }
response: DocumentSaveResult  // numeric enum from @ha/shared; 0 = Saved

enum DocumentSaveResult {
  Saved = 0, NothingToSave, Cancelled, DiskFull, NotPermitted, ReadOnlyDisk,
  FolderMissing, FileInUse, DocumentUnreadable, WriteFailed,
}
```

#### `storage-write-asset` (editor → embedder)

Stores an image or font the user added, keyed like the other asset requests.

```ts
payload:  { path: string; data: Uint8Array }
response: undefined
```

#### `color-theme-changed` (embedder → editor, notification)

```ts
payload: { theme: "light" | "dark" }
```

#### `browser-import` (embedder → editor)

Imports a browser capture (the payload `PenCapturer.capture()` resolves to)
onto the canvas, like a paste from the Chrome extension.

```ts
payload:  string  // the serialized capture
response: { success: boolean }
```

#### `open-link` (editor → embedder, capability)

A link the user opened in the editor, sent only when `pen:connect` lists
`"open-link"` in `capabilities`. Without it, the editor calls `window.open`.
Hosts that block `window.open`, such as sandboxed frames, need it for links to
work at all.

```ts
payload:  { url: string }  // http(s)
response: undefined        // an error response shows "Couldn't open the link"
```

### 4. Switching documents

The editor's dashboard asks the embedder for its documents. Switching to
another document reloads the editor, which starts again at the handshake.

#### `documents-list` / `documents-previews` (editor → embedder)

```ts
// documents-list: every document the dashboard shows
payload:  undefined
response: DashboardDocument[]

interface DashboardDocument {
  uri: string;
  kind: 0 | 1 | 2;                 // DocumentKind: File, Managed (a draft), Bundled
  name: string;
  preview: { kind: 0 };            // DashboardPreviewKind.None; thumbnails come from documents-previews
  folderName?: string;
  timestamps?: { createdAt: number; lastEditedAt: number; lastOpenedAt?: number };
}
// Recents shows documents with `lastOpenedAt`; Drafts shows `kind: 1`.

// documents-previews: thumbnails for the listed documents
payload:  { uris: string[] }
response: Record<string, Uint8Array>  // PNG per uri; leave out the ones without a preview
```

#### `documents-open` / `documents-new` / `documents-remove` (editor → embedder)

```ts
// documents-open / documents-new: switch to a document
payload:  { uri: string } / undefined
response: undefined

// documents-remove: Delete (1) or remove from recents (0)
payload:  { uris: string[]; removal: 0 | 1 }
response: string[]  // the uris that were removed
```

#### `save` (embedder → editor)

Writes pending edits now instead of waiting for autosave; they arrive as a
`storage-write`, and `save` resolves once it is answered. Send it before
switching documents, so the last edits aren't lost in the reload.

```ts
payload:  undefined
response: DocumentSaveResult  // NothingToSave (1) when nothing changed
```

### Errors

A failed request resolves as `{ kind: "response", id, error }`:

| `error.code`         | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `METHOD_NOT_ALLOWED` | The method is not one the editor accepts.                      |
| `INVALID_PAYLOAD`    | `browser-import` was sent with a non-string payload.           |
| `TOOL_NOT_FOUND`     | `mcp-tool-call` named a tool the canvas does not expose.       |
| `SAVE_FAILED`        | `save` threw instead of returning a `DocumentSaveResult`.      |
| `ERROR`              | Transport-level failure while executing the call.              |

A tool that ran but failed is **not** an error response — it resolves
normally with `isError: true` and the message in `content`.

### In this demo

- Electron can't `postMessage` into a `WebContentsView` from the outside, so
  `preload-editor.js` relays both ways: it forwards the editor's `pen:ready` to
  the main process and re-posts the main process's connect message into the
  page. As a fallback, the main process also connects once the page has
  loaded.
- `main.js` holds the port. It answers the `storage-*` requests from the
  current `.pen` file (`documents/untitled.pen` by default) and the
  `documents-*` requests from `documents/`, keeping recents in
  `documents/.recents.json` and previews in `documents/.previews/`.
- It forwards `selection-changed` to the sidebar and sends
  `color-theme-changed` when the theme setting or the system appearance
  changes.
- It exposes `get-mcp-schema` / `mcp-tool-call` to the chat renderer via
  `ipcMain`.
- Opening or creating a file sends `save`, swaps the storage target and
  reloads the editor page, which re-runs the handshake and `storage-load`s the
  new document.
