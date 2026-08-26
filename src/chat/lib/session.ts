/**
 * ChatSession — wraps a pi-agent-core Agent for one conversation: the
 * embedded canvas's MCP tools, a canvas-aware system prompt, persistence.
 */
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool, AgentToolResult, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, ImageContent, Message, Model, TextContent } from "@earendil-works/pi-ai";
import type { TSchema } from "@earendil-works/pi-ai";
import { Emitter } from "./emitter";
import { models } from "./models";
import { pen, type PenContentBlock, type PenToolDescriptor } from "./pen";
import { saveConversation, type Conversation } from "./storage";

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Providers require ^[a-zA-Z0-9_-]{1,64}$ tool names. */
function sanitizeToolName(name: string, taken: Set<string>): string {
  let base = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "tool";
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) candidate = `${base.slice(0, 60)}_${n++}`;
  taken.add(candidate);
  return candidate;
}

/** Anthropic & friends want an object schema at the top level. */
function normalizeSchema(schema: Record<string, unknown> | undefined): TSchema {
  if (!schema || typeof schema !== "object" || schema.type !== "object") {
    return { type: "object", properties: {}, additionalProperties: true } as unknown as TSchema;
  }
  return { properties: {}, ...schema } as unknown as TSchema;
}

function toolResultContent(blocks: PenContentBlock[]): (TextContent | ImageContent)[] {
  const content: (TextContent | ImageContent)[] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
      content.push({ type: "image", data: block.data, mimeType: block.mimeType });
    } else {
      content.push({ type: "text", text: JSON.stringify(block, null, 2) });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "(empty result)" });
  return content;
}

function makePenTool(descriptor: PenToolDescriptor, taken: Set<string>): AgentTool {
  const name = sanitizeToolName(descriptor.name, taken);
  return {
    label: descriptor.name,
    name,
    description: descriptor.description || `Tool "${descriptor.name}" provided by the pen.dev canvas.`,
    parameters: normalizeSchema(descriptor.inputSchema),
    execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
      const result = await pen.callTool(descriptor.name, params);
      if (result.isError) {
        throw new Error(
          result.content
            .map((b) => (b.type === "text" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
            .join("\n") || "Tool reported an error.",
        );
      }
      return {
        content: toolResultContent(result.content),
        details: { source: "pen-embed", tool: descriptor.name },
      };
    },
  };
}

function buildSystemPrompt(): string {
  const toolCount = pen.tools.length;
  const lines = [
    "You are the design copilot in a demo app that embeds the pen.dev canvas editor beside this chat.",
    "",
    pen.ready
      ? "The canvas on the right is live; everything you do through tools appears there immediately."
      : "The canvas is still starting up; tool calls may fail until it connects.",
    "",
    toolCount > 0
      ? `The canvas exposes ${toolCount} MCP tool(s) for reading and editing the design. These are the only way to act on the canvas — prefer them over describing what the user should do.`
      : "The canvas has not published its tools yet.",
    "",
    "Guidelines:",
    "- Be concise. The sidebar is narrow; prefer short paragraphs and tight lists.",
    "- Read the canvas state before editing when you are unsure what is there.",
    "- After acting, briefly confirm what changed.",
    "- If a tool fails, report the error plainly and suggest the next step.",
  ];
  return lines.join("\n");
}

export interface SessionState {
  conversationId: string;
  title: string;
}

export class ChatSession {
  readonly agent: Agent;
  readonly emitter = new Emitter();
  readonly conversationId: string;
  title: string;
  private createdAt: number;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribeTools: () => void;

  constructor(model: Model<Api>, thinkingLevel: ThinkingLevel, conversation?: Conversation) {
    this.conversationId = conversation?.id ?? uid();
    this.title = conversation?.title ?? "New chat";
    this.createdAt = conversation?.createdAt ?? Date.now();

    this.agent = new Agent({
      initialState: {
        systemPrompt: buildSystemPrompt(),
        model,
        thinkingLevel,
        messages: (conversation?.messages as Message[] | undefined) ?? [],
      },
      streamFn: (m, context, options) => models.streamSimple(m, context, options),
    });

    this.syncTools();
    this.unsubscribeTools = pen.emitter.subscribe(() => {
      this.syncTools();
      this.emitter.emit();
    });

    this.agent.subscribe((event) => {
      this.emitter.emit();
      if (event.type === "message_end" || event.type === "agent_end") this.scheduleSave();
    });
  }

  get model(): Model<Api> {
    return this.agent.state.model;
  }

  setModel(model: Model<Api>) {
    this.agent.state.model = model;
    this.emitter.emit();
  }

  get thinkingLevel(): ThinkingLevel {
    return this.agent.state.thinkingLevel;
  }

  setThinkingLevel(level: ThinkingLevel) {
    this.agent.state.thinkingLevel = level;
    this.emitter.emit();
  }

  private syncTools() {
    const taken = new Set<string>();
    this.agent.state.tools = pen.tools.map((d) => makePenTool(d, taken));
  }

  send(text: string) {
    if (this.title === "New chat") {
      this.title = text.length > 60 ? `${text.slice(0, 57)}…` : text;
    }
    this.agent.state.systemPrompt = buildSystemPrompt();
    this.syncTools();

    if (this.agent.state.isStreaming) {
      this.agent.steer({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
    } else {
      void this.agent.prompt(text).catch((error) => {
        console.error("[pen-embed-demo] prompt failed", error);
        this.emitter.emit();
      });
    }
    this.emitter.emit();
  }

  cancel() {
    this.agent.abort();
  }

  dispose() {
    this.unsubscribeTools();
    this.agent.abort();
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), 400);
  }

  async save(): Promise<void> {
    const messages = this.agent.state.messages.filter(
      (m): m is Message => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
    );
    if (messages.length === 0) return;
    const model = this.agent.state.model;
    await saveConversation({
      id: this.conversationId,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      messages: JSON.parse(JSON.stringify(messages)) as Message[],
      model: { provider: model.provider, id: model.id },
      thinkingLevel: this.agent.state.thinkingLevel,
    });
  }
}
