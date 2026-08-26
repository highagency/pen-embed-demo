# pen-embed-demo

Electron app demonstrating embedding the pen.dev web editor
(`apps/web-editor`) through its embed bridge, with a pi-agent chat sidebar
that drives the canvas through the bridge's MCP tools.

The main window hosts the chat sidebar (React + assistant-ui +
[pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core))
and a `WebContentsView` pointed at `http://localhost:3002/new?embed=true`.
The main process speaks the embed API described below; the chat agent picks
up the canvas tools automatically, streams, supports thinking levels,
tool-call inspection, history, and bring-your-own API keys (Anthropic,
OpenAI, Google, Moonshot, OpenRouter, and more) stored in `localStorage`.

## Run

1. Start the web editor dev server in the `ha` repo:

   ```sh
   npm --prefix apps/web-editor run dev   # http://localhost:3002
   ```

2. Start the demo:

   ```sh
   npm install
   npm start
   ```

3. Add an API key in the sidebar's Settings, then ask the agent to design
   something on the canvas.

`npm run dev` rebuilds the chat bundle on change.

## The pen embed API

Loading `/new?embed=true` puts the editor in embed mode: it renders no local
document UI and expects the embedding page (the *embedder*) to supply the
document and talk to it over a `MessagePort`.

### Connecting

Post a connect message into the editor page's window with one half of a
`MessageChannel`:

```ts
interface ConnectMessage {
  type: "pen:connect";
  /** Editor color scheme. Default: "dark". */
  theme?: "light" | "dark";
  /** URI reported as the open document's location. Optional. */
  fileURI?: string;
}

const channel = new MessageChannel();
editorWindow.postMessage(
  { type: "pen:connect", theme: "dark" } satisfies ConnectMessage,
  "*",
  [channel.port2],
);
```

The page answers `{ kind: "ready" }` on the port once its bridge is
listening. The bridge only starts with the client bundle, so re-send
`pen:connect` (a fresh channel each attempt) every ~500 ms until `ready`
arrives; the page always adopts the newest port. `ready` means the bridge is
up, not that the editor engine has finished booting — tool calls in the
first seconds can still fail while the canvas loads.

### Wire format

Every message on the port is one of:

```ts
type BridgeMessage =
  | { kind: "ready" }                                       // editor → embedder, once per port
  | { kind: "request"; id: string | number; method: string; payload?: unknown }
  | {
      kind: "response";
      id: string | number;                                  // echoes the request id
      payload?: unknown;
      error?: { code: string; message: string };            // set instead of payload on failure
    };
```

Requests flow in both directions; each must be answered with a `response`
carrying the same `id`.

### Methods: editor → embedder (storage)

The embedder owns the document; the editor persists through it. These four
requests must be handled (see `handleStorageRequest` in `main.js` for a
filesystem-backed reference implementation).

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

#### `storage-write`

```ts
payload:  { fileURI: string; content: string }
response: DocumentSaveResult  // numeric enum from @ha/shared; 0 = Saved

enum DocumentSaveResult { Saved = 0, NothingToSave, Cancelled, DiskFull, NotPermitted, ReadOnlyDisk }
```

#### `storage-read-asset` / `storage-write-asset` / `storage-has-asset`

Assets (e.g. images placed on the canvas) are keyed by a relative path.

```ts
// storage-read-asset
payload:  { path: string }
response: Uint8Array | undefined  // undefined when the asset does not exist

// storage-write-asset
payload:  { path: string; data: Uint8Array }
response: undefined

// storage-has-asset
payload:  { path: string }
response: boolean
```

### Methods: embedder → editor (MCP tools)

The bridge accepts exactly these two request methods.

#### `get-mcp-schema`

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

#### `mcp-tool-call`

Executes one tool and resolves with an MCP-style result.

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
(`src/chat/lib/pen.ts`, `src/chat/lib/session.ts`).

### Errors

A failed request resolves as `{ kind: "response", id, error }`:

| `error.code`         | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `METHOD_NOT_ALLOWED` | The method is not one of the two supported requests.           |
| `TOOL_NOT_FOUND`     | `mcp-tool-call` named a tool the canvas does not expose.       |
| `ERROR`              | Transport-level failure while executing the call.              |

A tool that ran but failed is **not** an error response — it resolves
normally with `isError: true` and the message in `content`.

### In this demo

Electron can't `postMessage` into a `WebContentsView` from the outside, so
the main process sends the connect message over an internal channel and
`preload-editor.js` re-posts it into the page's main world. `main.js` holds
the port: it answers the `storage-*` requests from `documents/` and exposes
`get-mcp-schema` / `mcp-tool-call` to the chat renderer via `ipcMain`.
