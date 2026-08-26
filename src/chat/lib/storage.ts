/**
 * localStorage backed persistence: settings, credentials (pi-ai
 * CredentialStore), model catalogs (pi-ai ModelsStore), and conversations.
 */
import type { Message } from "@earendil-works/pi-ai";
import type {
  Credential,
  CredentialInfo,
  CredentialStore,
  ModelsStore,
  ModelsStoreEntry,
} from "@earendil-works/pi-ai";

const PREFIX = "pen-embed-demo:";

export async function storageGet<T>(key: string): Promise<T | undefined> {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export async function storageRemove(key: string): Promise<void> {
  localStorage.removeItem(PREFIX + key);
}

/* ------------------------------- settings -------------------------------- */

export interface Settings {
  model?: { provider: string; id: string };
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  theme?: "dark" | "light" | "system";
}

const SETTINGS_KEY = "settings";

export const loadSettings = async (): Promise<Settings> => (await storageGet<Settings>(SETTINGS_KEY)) ?? {};
export const saveSettings = (settings: Settings) => storageSet(SETTINGS_KEY, settings);

/* ------------------------------ credentials ------------------------------ */

const credKey = (providerId: string) => `cred:${providerId}`;
const CRED_INDEX_KEY = "cred-index";

/** CredentialStore over localStorage. Writes serialized per provider. */
export class LocalCredentialStore implements CredentialStore {
  private chains = new Map<string, Promise<unknown>>();

  private enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(providerId) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.chains.set(providerId, next.catch(() => {}));
    return next;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return storageGet<Credential>(credKey(providerId));
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const ids = (await storageGet<string[]>(CRED_INDEX_KEY)) ?? [];
    const infos: CredentialInfo[] = [];
    for (const providerId of ids) {
      const cred = await this.read(providerId);
      if (cred) infos.push({ providerId, type: cred.type });
    }
    return infos;
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      const current = await this.read(providerId);
      const next = await fn(current);
      if (next !== undefined) {
        await storageSet(credKey(providerId), next);
        const ids = new Set((await storageGet<string[]>(CRED_INDEX_KEY)) ?? []);
        ids.add(providerId);
        await storageSet(CRED_INDEX_KEY, [...ids]);
        return next;
      }
      return current;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.enqueue(providerId, async () => {
      await storageRemove(credKey(providerId));
      const ids = new Set((await storageGet<string[]>(CRED_INDEX_KEY)) ?? []);
      ids.delete(providerId);
      await storageSet(CRED_INDEX_KEY, [...ids]);
    });
  }
}

/* ----------------------------- model catalogs ---------------------------- */

/** Persists dynamic provider catalogs (e.g. OpenRouter) across sessions. */
export class LocalModelsStore implements ModelsStore {
  async read(providerId: string): Promise<ModelsStoreEntry | undefined> {
    return storageGet<ModelsStoreEntry>(`models:${providerId}`);
  }
  async write(providerId: string, entry: ModelsStoreEntry): Promise<void> {
    await storageSet(`models:${providerId}`, entry);
  }
  async delete(providerId: string): Promise<void> {
    await storageRemove(`models:${providerId}`);
  }
}

/* ------------------------------ conversations ---------------------------- */

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation extends ConversationMeta {
  messages: Message[];
  model?: { provider: string; id: string };
  thinkingLevel?: Settings["thinkingLevel"];
}

const CONV_INDEX_KEY = "conv-index";
const convKey = (id: string) => `conv:${id}`;

export async function listConversations(): Promise<ConversationMeta[]> {
  const index = (await storageGet<ConversationMeta[]>(CONV_INDEX_KEY)) ?? [];
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadConversation(id: string): Promise<Conversation | undefined> {
  return storageGet<Conversation>(convKey(id));
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  await storageSet(convKey(conversation.id), conversation);
  const index = (await storageGet<ConversationMeta[]>(CONV_INDEX_KEY)) ?? [];
  const meta: ConversationMeta = {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
  const i = index.findIndex((m) => m.id === conversation.id);
  if (i >= 0) index[i] = meta;
  else index.push(meta);
  await storageSet(CONV_INDEX_KEY, index);
}

export async function deleteConversation(id: string): Promise<void> {
  await storageRemove(convKey(id));
  const index = (await storageGet<ConversationMeta[]>(CONV_INDEX_KEY)) ?? [];
  await storageSet(
    CONV_INDEX_KEY,
    index.filter((m) => m.id !== id),
  );
}
