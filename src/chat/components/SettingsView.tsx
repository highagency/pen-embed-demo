import { useEffect, useState } from "react";
import { getApiKey, listProviderInfos, setApiKey, type ProviderInfo } from "../lib/models";
import type { Theme } from "../lib/theme";
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "./Icons";
import { ProviderBadge } from "./ProviderBadge";

function ProviderRow({ provider }: { provider: ProviderInfo }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (editing) {
      void getApiKey(provider.id).then((k) => setValue(k ?? ""));
    }
  }, [editing, provider.id]);

  const save = async () => {
    await setApiKey(provider.id, value);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="provider-row">
      <div className="provider-info">
        <ProviderBadge providerId={provider.id} size={18} />
        <span className="provider-name">{provider.name}</span>
        {provider.configured && !editing && (
          <span className="provider-badge">
            <CheckIcon width={11} height={11} /> key set
          </span>
        )}
        {saved && <span className="provider-badge provider-badge--flash">saved</span>}
      </div>
      {editing ? (
        <div className="provider-edit">
          <input
            className="key-input"
            type="password"
            placeholder={`${provider.name} API key`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
          />
          <button className="small-btn small-btn--primary" onClick={() => void save()}>
            Save
          </button>
          <button className="small-btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="provider-actions">
          {provider.keyUrl && (
            <a className="link-btn" href={provider.keyUrl} target="_blank" rel="noreferrer">
              get key
            </a>
          )}
          <button className="small-btn" onClick={() => setEditing(true)}>
            {provider.configured ? "Edit" : "Add key"}
          </button>
        </div>
      )}
    </div>
  );
}

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

export function SettingsView({
  onBack,
  theme,
  onThemeChange,
}: {
  onBack: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  const providers = listProviderInfos();
  const configured = providers.filter((p) => p.configured);
  const rest = providers.filter((p) => !p.configured);

  return (
    <div className="settings">
      <div className="settings-section">Appearance</div>
      <div className="theme-row" role="radiogroup" aria-label="Theme">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            className={`theme-option ${theme === value ? "theme-option--active" : ""}`}
            role="radio"
            aria-checked={theme === value}
            onClick={() => onThemeChange(value)}
          >
            <Icon width={13} height={13} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="settings-section">Providers</div>
      <p className="settings-intro">
        Bring your own API keys. They are stored locally on this machine and sent only to the provider you
        choose.
      </p>
      {[...configured, ...rest].map((p) => (
        <ProviderRow key={p.id} provider={p} />
      ))}
      <div className="settings-footer">
        <button className="primary-btn" onClick={onBack}>
          Done
        </button>
      </div>
    </div>
  );
}
