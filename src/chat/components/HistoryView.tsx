import { useEffect, useState } from "react";
import { deleteConversation, listConversations, type ConversationMeta } from "../lib/storage";
import { TrashIcon } from "./Icons";

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function HistoryView({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const [items, setItems] = useState<ConversationMeta[] | null>(null);

  const refresh = () => void listConversations().then(setItems);
  useEffect(refresh, []);

  if (items === null) return <div className="history-empty">Loading…</div>;
  if (items.length === 0)
    return (
      <div className="history-empty">
        No saved chats yet.
        <button className="link-btn" onClick={onBack}>
          start one
        </button>
      </div>
    );

  return (
    <div className="history">
      {items.map((item) => (
        <div key={item.id} className="history-row">
          <button className="history-open" onClick={() => onOpen(item.id)}>
            <span className="history-title">{item.title}</span>
            <span className="history-time">{timeAgo(item.updatedAt)}</span>
          </button>
          <button
            className="icon-btn icon-btn--danger"
            title="Delete"
            aria-label={`Delete ${item.title}`}
            onClick={() => {
              void deleteConversation(item.id).then(refresh);
            }}
          >
            <TrashIcon width={14} height={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
