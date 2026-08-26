/**
 * pi-ai model registry for the chat sidebar: a curated set of browser-safe
 * providers backed by localStorage credential + catalog stores.
 */
import { createModels, type Model, type Api, type MutableModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { cerebrasProvider } from "@earendil-works/pi-ai/providers/cerebras";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { LocalCredentialStore, LocalModelsStore } from "./storage";
import { Emitter } from "./emitter";

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  /** URL where the user can create an API key. */
  keyUrl?: string;
}

const KEY_URLS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
  moonshotai: "https://platform.moonshot.ai/console/api-keys",
  openrouter: "https://openrouter.ai/settings/keys",
  groq: "https://console.groq.com/keys",
  xai: "https://console.x.ai",
  deepseek: "https://platform.deepseek.com/api_keys",
  mistral: "https://console.mistral.ai/api-keys",
  cerebras: "https://cloud.cerebras.ai",
  zai: "https://z.ai/manage-apikey/apikey-list",
};

export const credentials = new LocalCredentialStore();

export const models: MutableModels = createModels({
  credentials,
  modelsStore: new LocalModelsStore(),
});

for (const provider of [
  anthropicProvider(),
  openaiProvider(),
  googleProvider(),
  moonshotaiProvider(),
  openrouterProvider(),
  groqProvider(),
  xaiProvider(),
  deepseekProvider(),
  mistralProvider(),
  cerebrasProvider(),
  zaiProvider(),
]) {
  models.setProvider(provider);
}

/** Emits when credentials or catalogs change (so pickers can re-render). */
export const modelsEmitter = new Emitter();

let configuredIds = new Set<string>();

export async function refreshConfiguredProviders(): Promise<void> {
  const infos = await credentials.list();
  configuredIds = new Set(infos.map((i) => i.providerId));
  modelsEmitter.emit();
  /* Pull dynamic catalogs (OpenRouter) in the background; cheap no-op for
     static providers and unconfigured ones. */
  void models.refresh({ allowNetwork: true }).then(() => modelsEmitter.emit());
}

export const isConfigured = (providerId: string) => configuredIds.has(providerId);

export function listProviderInfos(): ProviderInfo[] {
  return models.getProviders().map((p) => ({
    id: p.id,
    name: p.name,
    configured: configuredIds.has(p.id),
    keyUrl: KEY_URLS[p.id],
  }));
}

export async function setApiKey(providerId: string, key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    await credentials.delete(providerId);
  } else {
    await credentials.modify(providerId, async () => ({ type: "api_key", key: trimmed }));
  }
  await refreshConfiguredProviders();
}

export async function getApiKey(providerId: string): Promise<string | undefined> {
  const cred = await credentials.read(providerId);
  return cred?.type === "api_key" ? cred.key : undefined;
}

/** Models from configured providers, for the picker. */
export function listAvailableModels(): Model<Api>[] {
  const result: Model<Api>[] = [];
  for (const provider of models.getProviders()) {
    if (!configuredIds.has(provider.id)) continue;
    result.push(...provider.getModels());
  }
  return result;
}

/** Sensible fallback when the user hasn't picked a model yet. */
export function defaultModel(): Model<Api> | undefined {
  const preferred: [string, string][] = [
    ["anthropic", "claude-sonnet-4-5"],
    ["openai", "gpt-5.2"],
    ["moonshotai", "kimi-k2-0905-preview"],
    ["openrouter", "anthropic/claude-sonnet-4.5"],
  ];
  for (const [provider, id] of preferred) {
    if (!configuredIds.has(provider)) continue;
    const model = models.getModel(provider, id);
    if (model) return model;
  }
  return listAvailableModels()[0];
}
