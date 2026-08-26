/**
 * Converts a pi transcript (user / assistant / toolResult messages) into
 * assistant-ui ThreadMessageLike objects. Tool results are folded into the
 * originating assistant message's tool-call parts.
 */
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, ToolResultMessage } from "@earendil-works/pi-ai";

const textOfToolResult = (result: ToolResultMessage): string =>
  result.content
    .map((block) => (block.type === "text" ? block.text : `[image ${block.mimeType}]`))
    .join("\n");

export function toThreadMessages(agentMessages: readonly AgentMessage[], isRunning: boolean): ThreadMessageLike[] {
  const messages = agentMessages.filter(
    (m): m is Message =>
      typeof (m as { role?: unknown }).role === "string" &&
      ["user", "assistant", "toolResult"].includes((m as { role: string }).role),
  );

  const resultsByCallId = new Map<string, ToolResultMessage>();
  for (const message of messages) {
    if (message.role === "toolResult") resultsByCallId.set(message.toolCallId, message);
  }

  const out: ThreadMessageLike[] = [];

  messages.forEach((message, index) => {
    const id = `m-${message.timestamp}-${index}`;

    if (message.role === "user") {
      const content =
        typeof message.content === "string"
          ? [{ type: "text" as const, text: message.content }]
          : message.content.map((part) =>
              part.type === "text"
                ? { type: "text" as const, text: part.text }
                : { type: "image" as const, image: `data:${part.mimeType};base64,${part.data}` },
            );
      /* Steering injects user messages mid-run; hide empty ones. */
      if (content.length > 0) out.push({ role: "user", id, content });
      return;
    }

    if (message.role === "assistant") {
      const assistant = message as AssistantMessage;
      const parts: Exclude<ThreadMessageLike["content"], string>[number][] = [];

      for (const block of assistant.content) {
        if (block.type === "thinking") {
          if (block.thinking.trim()) parts.push({ type: "reasoning", text: block.thinking });
        } else if (block.type === "text") {
          if (block.text.trim()) parts.push({ type: "text", text: block.text });
        } else if (block.type === "toolCall") {
          const result = resultsByCallId.get(block.id);
          parts.push({
            type: "tool-call",
            toolCallId: block.id,
            toolName: block.name,
            args: block.arguments as never,
            result: result ? textOfToolResult(result) : undefined,
            isError: result?.isError,
          });
        }
      }

      const isLast = index === messages.length - 1 || messages.slice(index + 1).every((m) => m.role === "toolResult");
      const status: ThreadMessageLike["status"] =
        assistant.stopReason === "error"
          ? { type: "incomplete", reason: "error", error: assistant.errorMessage ?? "Unknown error" }
          : assistant.stopReason === "aborted"
            ? { type: "incomplete", reason: "cancelled" }
            : assistant.stopReason === "length"
              ? { type: "incomplete", reason: "length" }
              : isRunning && isLast
                ? { type: "running" }
                : { type: "complete", reason: "stop" };

      if (parts.length === 0 && !(isRunning && isLast) && assistant.stopReason !== "error") return;
      if (parts.length === 0 && assistant.stopReason === "error") {
        parts.push({ type: "text", text: "" });
      }
      out.push({ role: "assistant", id, content: parts, status });
      return;
    }
    /* toolResult messages are folded into tool-call parts above. */
  });

  return out;
}
