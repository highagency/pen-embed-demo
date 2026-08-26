import {
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ReasoningMessagePartComponent,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";
import type { ChatSession } from "../lib/session";
import { listAvailableModels } from "../lib/models";
import { pen } from "../lib/pen";
import { ChevronDownIcon, SendIcon, SparkIcon, StopIcon, ToolIcon } from "./Icons";

const MarkdownText = () => (
  <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="md" smooth />
);

const ReasoningPart: ReasoningMessagePartComponent = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={`reasoning ${open ? "reasoning--open" : ""}`}>
      <button className="reasoning-toggle" onClick={() => setOpen((v) => !v)}>
        <SparkIcon width={11} height={11} />
        <span>Reasoning</span>
        <ChevronDownIcon width={11} height={11} className="reasoning-chevron" />
      </button>
      {open && <pre className="reasoning-body">{text}</pre>}
    </div>
  );
};

const ToolCallPart: ToolCallMessagePartComponent = ({ toolName, args, result, isError, status }) => {
  const [open, setOpen] = useState(false);
  const running = status.type === "running" || (result === undefined && status.type !== "incomplete");
  return (
    <div className={`toolcall ${isError ? "toolcall--error" : ""}`}>
      <button className="toolcall-header" onClick={() => setOpen((v) => !v)}>
        <span className={`toolcall-dot ${running ? "toolcall-dot--running" : isError ? "toolcall-dot--error" : "toolcall-dot--done"}`} />
        <ToolIcon width={12} height={12} />
        <span className="toolcall-name">{toolName}</span>
        <span className="toolcall-state">{running ? "running…" : isError ? "error" : "done"}</span>
        <ChevronDownIcon width={11} height={11} className="reasoning-chevron" />
      </button>
      {open && (
        <div className="toolcall-body">
          <div className="toolcall-section">args</div>
          <pre>{JSON.stringify(args, null, 2)}</pre>
          {result !== undefined && (
            <>
              <div className="toolcall-section">result</div>
              <pre>{typeof result === "string" ? result : JSON.stringify(result, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const UserMessage = () => (
  <MessagePrimitive.Root className="msg msg--user">
    <div className="msg-bubble">
      <MessagePrimitive.Parts />
    </div>
  </MessagePrimitive.Root>
);

const AssistantMessage = () => (
  <MessagePrimitive.Root className="msg msg--assistant">
    <MessagePrimitive.Parts
      components={{ Text: MarkdownText, Reasoning: ReasoningPart, tools: { Fallback: ToolCallPart } }}
    />
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="msg-error">
        <ErrorPrimitive.Message />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  </MessagePrimitive.Root>
);

function EmptyState({ hasModel, onOpenSettings }: { hasModel: boolean; onOpenSettings: () => void }) {
  const tools = pen.tools;
  if (!hasModel) {
    return (
      <div className="empty">
        <div className="empty-logo" />
        <h2>Pen Embed Demo</h2>
        <p>An agent for the pen.dev canvas beside you, powered by its MCP tools.</p>
        <button className="primary-btn" onClick={onOpenSettings}>
          Add an API key to start
        </button>
        <p className="empty-fine">Anthropic, OpenAI, Moonshot, OpenRouter and more. Keys stay on this machine.</p>
      </div>
    );
  }
  return (
    <div className="empty">
      <div className="empty-logo" />
      <h2>{tools.length > 0 ? "Canvas connected" : pen.ready ? "Ready" : "Waiting for the canvas…"}</h2>
      {tools.length > 0 ? (
        <>
          <p>
            The canvas exposes {tools.length} MCP tool
            {tools.length === 1 ? "" : "s"}:
          </p>
          <div className="empty-tools">
            {tools.slice(0, 6).map((t) => (
              <span className="empty-tool" key={t.name}>
                {t.name}
              </span>
            ))}
            {tools.length > 6 && <span className="empty-tool">+{tools.length - 6} more</span>}
          </div>
          <p className="empty-fine">Ask the agent to design something.</p>
        </>
      ) : (
        <p className="empty-fine">
          {pen.ready
            ? "The canvas hasn't published its tools yet."
            : "Start the web editor (apps/web-editor, port 3002) and the canvas will connect automatically."}
        </p>
      )}
    </div>
  );
}

export function Thread({ session, onOpenSettings }: { session: ChatSession | null; onOpenSettings: () => void }) {
  const hasModel = session !== null || listAvailableModels().length > 0;

  return (
    <ThreadPrimitive.Root className="thread">
      <ThreadPrimitive.Viewport className="thread-viewport">
        <ThreadPrimitive.Empty>
          <EmptyState hasModel={hasModel} onOpenSettings={onOpenSettings} />
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        <div className="thread-spacer" />
      </ThreadPrimitive.Viewport>

      <div className="composer-wrap">
        <ComposerPrimitive.Root className="composer">
          <ComposerPrimitive.Input
            className="composer-input"
            placeholder={session ? "Message the agent…" : "Add an API key in Settings first"}
            minRows={1}
            maxRows={8}
            autoFocus
            disabled={!session}
          />
          <ThreadPrimitive.If running={false}>
            <ComposerPrimitive.Send className="composer-send" title="Send" aria-label="Send">
              <SendIcon />
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel className="composer-send composer-stop" title="Stop" aria-label="Stop">
              <StopIcon />
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}
