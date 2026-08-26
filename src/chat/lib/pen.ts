/**
 * Chat-side view of the embedded pen.dev canvas. The Electron main process
 * owns the embed-bridge session; this talks to it through the `demo` preload
 * API and mirrors the two bridge messages: `get-mcp-schema` for the tool
 * list and `mcp-tool-call` for execution.
 */
import { Emitter } from "./emitter";

export interface PenToolDescriptor {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export type PenContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: string; [key: string]: unknown };

export interface PenToolResult {
  content: PenContentBlock[];
  isError?: boolean;
}

export interface PenFileInfo {
  name: string;
  path: string;
}

declare global {
  interface Window {
    demo: {
      canvasReady: () => Promise<boolean>;
      onCanvasStatus: (callback: (ready: boolean) => void) => void;
      mcpSchema: () => Promise<{ tools?: PenToolDescriptor[] }>;
      mcpToolCall: (name: string, args: unknown) => Promise<PenToolResult>;
      currentFile: () => Promise<PenFileInfo>;
      openFile: () => Promise<PenFileInfo | undefined>;
      newFile: () => Promise<PenFileInfo | undefined>;
      onFileChanged: (callback: (file: PenFileInfo) => void) => void;
    };
  }
}

class PenCanvasConnection {
  readonly emitter = new Emitter();

  private _ready = false;
  private _tools: PenToolDescriptor[] = [];
  private _file: PenFileInfo | undefined;

  get ready(): boolean {
    return this._ready;
  }

  get tools(): readonly PenToolDescriptor[] {
    return this._tools;
  }

  get file(): PenFileInfo | undefined {
    return this._file;
  }

  async init(): Promise<void> {
    window.demo.onCanvasStatus((ready) => {
      this._ready = ready;
      if (ready) {
        void this.refreshTools();
      } else {
        this._tools = [];
      }
      this.emitter.emit();
    });
    window.demo.onFileChanged((file) => {
      this._file = file;
      this.emitter.emit();
    });
    try {
      this._ready = await window.demo.canvasReady();
      this._file = await window.demo.currentFile();
    } catch {
      this._ready = false;
    }
    if (this._ready) await this.refreshTools();
    this.emitter.emit();
  }

  /** Pick an existing .pen file and load it into the canvas. */
  async openFile(): Promise<void> {
    const file = await window.demo.openFile();
    if (file) {
      this._file = file;
      this.emitter.emit();
    }
  }

  /** Create a fresh .pen file (save dialog) and load it into the canvas. */
  async newFile(): Promise<void> {
    const file = await window.demo.newFile();
    if (file) {
      this._file = file;
      this.emitter.emit();
    }
  }

  /** Ask the canvas for its current MCP tool schemas. */
  async refreshTools(): Promise<void> {
    try {
      const response = await window.demo.mcpSchema();
      this._tools = response?.tools ?? [];
    } catch {
      this._tools = [];
    }
    this.emitter.emit();
  }

  callTool(name: string, args: unknown): Promise<PenToolResult> {
    return window.demo.mcpToolCall(name, args);
  }
}

export const pen = new PenCanvasConnection();
