import { useEffect, useState, type FormEvent } from "react";
import type { BrowserViewPick } from "@pen.dev/sdk";
import { browser, browserApi } from "./browser";

function useBrowser() {
  const [, setTick] = useState(0);
  useEffect(() => browser.emitter.subscribe(() => setTick((t) => t + 1)), []);
  return browser;
}

export function BrowserPanel() {
  const pane = useBrowser();
  const [url, setUrl] = useState("https://example.com");
  const [selector, setSelector] = useState("");
  const pick = pane.picker?.pick;

  const onNavigate = (e: FormEvent) => {
    e.preventDefault();
    browserApi().navigate(url);
  };
  const onSelect = (e: FormEvent) => {
    e.preventDefault();
    browserApi().hover(null);
    void browserApi().select(selector);
  };

  return (
    <div className="browser-panel">
      <div className="browser-row">
        <form className="browser-form" onSubmit={onNavigate}>
          <input className="browser-input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="browser-btn" type="submit">
            Go
          </button>
        </form>
        <button className="browser-btn" onClick={() => browserApi().pick()}>
          {pane.picker ? "Stop" : "Pick"}
        </button>
        <form className="browser-form" onSubmit={onSelect}>
          <input
            className="browser-input"
            placeholder="CSS selector"
            value={selector}
            onChange={(e) => {
              setSelector(e.target.value);
              browserApi().hover(e.target.value || null);
            }}
            onBlur={() => browserApi().hover(null)}
          />
          <button className="browser-btn" type="submit">
            Select
          </button>
        </form>
        <button className="browser-btn browser-btn--primary" onClick={() => browserApi().import()}>
          Import
        </button>
        <span className="browser-status" title={pane.status}>
          {pane.status}
        </span>
      </div>
      <Breadcrumb pick={pick} />
      <Details picked={pick?.element} />
    </div>
  );
}

function Breadcrumb({ pick }: { pick: BrowserViewPick | undefined }) {
  const path = pick?.path ?? [];
  return (
    <div className="browser-row browser-path">
      {path.map((entry, index) => (
        <span key={index} className="browser-crumb">
          <button
            className={`browser-crumb-btn ${index === pick?.pathIndex ? "browser-crumb-btn--current" : ""}`}
            onClick={() => browserApi().selectPath(index)}
            onMouseEnter={() => browserApi().hoverPath(index)}
            onMouseLeave={() => browserApi().hoverPath(null)}
          >
            {entry.componentName && <span className="browser-component">{entry.componentName} </span>}
            {entry.label}
          </button>
          {index < path.length - 1 && <span className="browser-crumb-sep">›</span>}
        </span>
      ))}
    </div>
  );
}

function Details({ picked }: { picked: BrowserViewPick["element"] | undefined }) {
  if (!picked) return <div className="browser-details" />;
  const fields: Record<string, unknown> = {
    selector: picked.selector,
    component: picked.componentName,
    size: `${picked.width}×${picked.height} at ${picked.x},${picked.y}`,
    class: picked.className,
    ...picked.styles,
  };
  return (
    <div className="browser-details">
      {Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => {
          const text = typeof value === "object" ? JSON.stringify(value) : String(value);
          return (
            <div key={key} className="browser-detail" title={text}>
              <b>{key}: </b>
              {text}
            </div>
          );
        })}
    </div>
  );
}
