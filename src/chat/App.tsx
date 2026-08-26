import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { useCallback, useEffect, useState } from "react";
import { HistoryView } from "./components/HistoryView";
import { SettingsView } from "./components/SettingsView";
import { Thread } from "./components/Thread";
import { TopBar } from "./components/TopBar";
import { toThreadMessages } from "./lib/convert";
import type { Emitter } from "./lib/emitter";
import { defaultModel, models, modelsEmitter } from "./lib/models";
import { pen } from "./lib/pen";
import { ChatSession } from "./lib/session";
import { loadConversation, loadSettings, saveSettings, type Settings } from "./lib/storage";
import { applyTheme, type Theme } from "./lib/theme";

export type View = "chat" | "settings" | "history";

/** Re-render when an emitter fires, coalesced to animation frames. */
function useTick(emitter: Emitter | undefined) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!emitter) return;
    let raf = 0;
    const unsubscribe = emitter.subscribe(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((t) => t + 1));
    });
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [emitter]);
}

export function App() {
  const [view, setView] = useState<View>("chat");
  const [settings, setSettings] = useState<Settings>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [session, setSession] = useState<ChatSession | null>(null);

  useTick(modelsEmitter);
  useTick(pen.emitter);
  useTick(session?.emitter);

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setSettingsLoaded(true);
    });
  }, []);

  const resolveModel = useCallback((s: Settings): Model<Api> | undefined => {
    if (s.model) {
      const m = models.getModel(s.model.provider, s.model.id);
      if (m) return m;
    }
    return defaultModel();
  }, []);

  /* Create the initial session once settings load and a usable model exists
     (i.e. at least one provider has an API key). */
  useEffect(() => {
    if (!settingsLoaded || session) return;
    const model = resolveModel(settings);
    if (model) setSession(new ChatSession(model, settings.thinkingLevel ?? "off"));
  });

  const newChat = useCallback(() => {
    setSession((prev) => {
      prev?.dispose();
      const model = resolveModel(settings);
      return model ? new ChatSession(model, settings.thinkingLevel ?? "off") : null;
    });
    setView("chat");
  }, [settings, resolveModel]);

  const openConversation = useCallback(
    async (id: string) => {
      const conversation = await loadConversation(id);
      if (!conversation) return;
      const model =
        (conversation.model && models.getModel(conversation.model.provider, conversation.model.id)) ||
        resolveModel(settings);
      if (!model) return;
      setSession((prev) => {
        prev?.dispose();
        return new ChatSession(model, conversation.thinkingLevel ?? settings.thinkingLevel ?? "off", conversation);
      });
      setView("chat");
    },
    [settings, resolveModel],
  );

  const onModelChange = useCallback(
    (model: Model<Api>) => {
      session?.setModel(model);
      const next: Settings = { ...settings, model: { provider: model.provider, id: model.id } };
      setSettings(next);
      void saveSettings(next);
    },
    [session, settings],
  );

  const onThemeChange = useCallback(
    (theme: Theme) => {
      applyTheme(theme);
      const next: Settings = { ...settings, theme };
      setSettings(next);
      void saveSettings(next);
    },
    [settings],
  );

  const onThinkingChange = useCallback(
    (level: ThinkingLevel) => {
      session?.setThinkingLevel(level);
      const next: Settings = { ...settings, thinkingLevel: level };
      setSettings(next);
      void saveSettings(next);
    },
    [session, settings],
  );

  const agentState = session?.agent.state;
  const isRunning = agentState?.isStreaming ?? false;

  const allMessages = agentState
    ? agentState.streamingMessage
      ? [...agentState.messages, agentState.streamingMessage]
      : agentState.messages
    : [];
  const threadMessages = toThreadMessages(allMessages, isRunning);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      if (!session) return;
      const text = message.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n\n");
      if (text.trim().length === 0) return;
      session.send(text);
    },
    [session],
  );

  const onCancel = useCallback(async () => session?.cancel(), [session]);

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: threadMessages,
    isRunning,
    convertMessage: (m) => m,
    onNew,
    onCancel,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="app">
        <TopBar
          view={view}
          onNavigate={setView}
          onNewChat={newChat}
          session={session}
          onModelChange={onModelChange}
          onThinkingChange={onThinkingChange}
        />
        <div className="app-body">
          {view === "chat" && <Thread session={session} onOpenSettings={() => setView("settings")} />}
          {view === "settings" && (
            <SettingsView onBack={() => setView("chat")} theme={settings.theme ?? "dark"} onThemeChange={onThemeChange} />
          )}
          {view === "history" && (
            <HistoryView onOpen={(id) => void openConversation(id)} onBack={() => setView("chat")} />
          )}
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
