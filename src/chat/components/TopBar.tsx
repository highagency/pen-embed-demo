import { useEffect, useRef, useState } from "react";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { View } from "../App";
import type { ChatSession } from "../lib/session";
import { listAvailableModels } from "../lib/models";
import { pen } from "../lib/pen";
import {
  BackIcon,
  CheckIcon,
  ChevronDownIcon,
  FilePlusIcon,
  FolderIcon,
  GearIcon,
  HistoryIcon,
  PlusIcon,
  ToolIcon,
} from "./Icons";
import { ProviderBadge } from "./ProviderBadge";

export function TopBar(props: {
  view: View;
  onNavigate: (view: View) => void;
  onNewChat: () => void;
  session: ChatSession | null;
  onModelChange: (model: Model<Api>) => void;
  onThinkingChange: (level: ThinkingLevel) => void;
}) {
  const { view, onNavigate, onNewChat, session } = props;
  const [toolsOpen, setToolsOpen] = useState(false);

  const tools = pen.tools;

  if (view !== "chat") {
    return (
      <header className="topbar">
        <button className="icon-btn" onClick={() => onNavigate("chat")} title="Back" aria-label="Back">
          <BackIcon />
        </button>
        <div className="topbar-title">{view === "settings" ? "Settings" : "Chats"}</div>
      </header>
    );
  }

  return (
    <header className="topbar">
      <div
        className="page-chip"
        title={
          pen.file
            ? `${pen.file.path}${pen.ready ? "" : " (connecting…)"}`
            : "Waiting for the embedded editor"
        }
      >
        <span className={`canvas-dot ${pen.ready ? "canvas-dot--ready" : ""}`} />
        <span className="page-title">
          {pen.file?.name ?? (pen.ready ? "pen.dev canvas" : "Canvas connecting…")}
        </span>
      </div>

      <button
        className={`tools-chip ${tools.length > 0 ? "tools-chip--live" : ""}`}
        onClick={() => setToolsOpen((v) => !v)}
        title="MCP tools from the canvas"
      >
        <ToolIcon width={12} height={12} />
        <span>{tools.length}</span>
      </button>

      <div className="topbar-actions">
        <button
          className="icon-btn"
          onClick={() => void pen.newFile()}
          title="New .pen file"
          aria-label="New .pen file"
        >
          <FilePlusIcon />
        </button>
        <button
          className="icon-btn"
          onClick={() => void pen.openFile()}
          title="Open .pen file"
          aria-label="Open .pen file"
        >
          <FolderIcon />
        </button>
        <button className="icon-btn" onClick={onNewChat} title="New chat" aria-label="New chat">
          <PlusIcon />
        </button>
        <button className="icon-btn" onClick={() => onNavigate("history")} title="Chats" aria-label="Chats">
          <HistoryIcon />
        </button>
        <button className="icon-btn" onClick={() => onNavigate("settings")} title="Settings" aria-label="Settings">
          <GearIcon />
        </button>
      </div>

      {toolsOpen && <ToolsPopover onClose={() => setToolsOpen(false)} />}
      {session && (
        <ModelBar session={session} onModelChange={props.onModelChange} onThinkingChange={props.onThinkingChange} />
      )}
    </header>
  );
}

function ToolsPopover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const tools = pen.tools;
  return (
    <div className="popover tools-popover" ref={ref}>
      <div className="popover-header">
        <span>Canvas MCP tools</span>
        <button className="link-btn" onClick={() => void pen.refreshTools()}>
          refresh
        </button>
      </div>
      {tools.length === 0 ? (
        <div className="popover-empty">
          The canvas hasn't published any tools yet.
          <span className="popover-hint">
            Tools arrive over the embed bridge (<code>get-mcp-schema</code>) once the editor connects.
          </span>
        </div>
      ) : (
        <ul className="tools-list">
          {tools.map((tool) => (
            <li key={tool.name}>
              <div className="tool-name">{tool.name}</div>
              {tool.description && <div className="tool-desc">{tool.description}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const THINKING_LABELS: Record<string, string> = {
  off: "Thinking off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

/** Second row of the top bar: model + thinking level. */
function ModelBar(props: {
  session: ChatSession;
  onModelChange: (model: Model<Api>) => void;
  onThinkingChange: (level: ThinkingLevel) => void;
}) {
  const { session } = props;
  const [pickerOpen, setPickerOpen] = useState(false);
  const model = session.model;
  const levels = getSupportedThinkingLevels(model);

  const cycleThinking = () => {
    const current = session.thinkingLevel;
    const index = levels.indexOf(current as (typeof levels)[number]);
    const next = levels[(index + 1) % levels.length];
    props.onThinkingChange(next as ThinkingLevel);
  };

  return (
    <div className="modelbar">
      <button className="model-pill" onClick={() => setPickerOpen((v) => !v)} title={`${model.provider} · ${model.id}`}>
        <ProviderBadge providerId={model.provider} size={14} />
        <span className="model-name">{model.name}</span>
        <ChevronDownIcon width={12} height={12} />
      </button>
      {model.reasoning && levels.length > 1 && (
        <button className="thinking-pill" onClick={cycleThinking} title="Cycle thinking effort">
          {THINKING_LABELS[session.thinkingLevel] ?? session.thinkingLevel}
        </button>
      )}
      {pickerOpen && (
        <ModelPicker
          current={model}
          onSelect={(m) => {
            props.onModelChange(m);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function ModelPicker(props: { current: Model<Api>; onSelect: (m: Model<Api>) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [props]);

  const all = listAvailableModels();
  const q = query.trim().toLowerCase();
  const filtered = q
    ? all.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.provider.includes(q))
    : all;

  const byProvider = new Map<string, Model<Api>[]>();
  for (const m of filtered) {
    const list = byProvider.get(m.provider) ?? [];
    list.push(m);
    byProvider.set(m.provider, list);
  }

  return (
    <div className="popover model-popover" ref={ref}>
      <input
        className="model-search"
        placeholder="Search models…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="model-list">
        {byProvider.size === 0 && <div className="popover-empty">No models. Add an API key in Settings.</div>}
        {[...byProvider.entries()].map(([provider, providerModels]) => (
          <div key={provider}>
            <div className="model-group">
              <ProviderBadge providerId={provider} size={14} />
              <span>{provider}</span>
            </div>
            {providerModels.map((m) => (
              <button
                key={`${m.provider}/${m.id}`}
                className="model-row"
                onClick={() => props.onSelect(m)}
                title={m.id}
              >
                <span className="model-row-name">{m.name}</span>
                {m.provider === props.current.provider && m.id === props.current.id && (
                  <CheckIcon width={13} height={13} />
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
