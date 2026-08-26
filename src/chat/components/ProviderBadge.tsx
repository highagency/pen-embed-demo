/**
 * Compact monogram badges for providers — brand-tinted, trademark-free,
 * and legible at 14px in both themes.
 */
const PROVIDER_META: Record<string, { initials: string; color: string }> = {
  anthropic: { initials: "A", color: "#d97757" },
  openai: { initials: "OA", color: "#10a37f" },
  google: { initials: "G", color: "#4285f4" },
  moonshotai: { initials: "K", color: "#5b8bff" },
  openrouter: { initials: "OR", color: "#a78bfa" },
  groq: { initials: "GQ", color: "#f55036" },
  xai: { initials: "X", color: "#94a3b8" },
  deepseek: { initials: "DS", color: "#4d6bfe" },
  mistral: { initials: "M", color: "#fa520f" },
  cerebras: { initials: "C", color: "#ff9e2c" },
  zai: { initials: "Z", color: "#38bdf8" },
};

export function ProviderBadge({ providerId, size = 16 }: { providerId: string; size?: number }) {
  const meta = PROVIDER_META[providerId] ?? {
    initials: providerId.slice(0, 2).toUpperCase(),
    color: "#8a93a1",
  };
  return (
    <span
      className="pbadge"
      style={{
        width: size,
        height: size,
        fontSize: meta.initials.length > 1 ? size * 0.42 : size * 0.55,
        color: meta.color,
        background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
        borderColor: `color-mix(in srgb, ${meta.color} 35%, transparent)`,
      }}
      aria-hidden
    >
      {meta.initials}
    </span>
  );
}
