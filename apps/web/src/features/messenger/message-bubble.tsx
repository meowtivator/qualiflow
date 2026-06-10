import type { Message } from "@qualiflow/core";

import { formatTime } from "./format";

type MessageBubbleProps = {
  message: Message;
};

export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <article className={`message-bubble ${message.direction}`}>
      <div className="message-header">
        <strong>{message.author.displayName}</strong>
        <span>{formatTime(message.sentAt)}</span>
      </div>
      <p>{message.content.text}</p>
    </article>
  );
}
