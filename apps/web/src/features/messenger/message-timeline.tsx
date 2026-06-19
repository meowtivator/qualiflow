"use client";

import { useEffect, useMemo, useRef } from "react";

import type { Message } from "@qualiflow/core";

import { MessageBubble } from "./message-bubble";

type MessageTimelineProps = {
  messages: Message[];
};

export function MessageTimeline({ messages }: MessageTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const latestMessageId = messages.at(-1)?.id;

  useEffect(() => {
    const timeline = timelineRef.current;

    if (!timeline) {
      return;
    }

    const scrollToLatestMessage = () => {
      timeline.scrollTop = 0;
    };

    let secondFrame: number | undefined;

    const firstFrame = window.requestAnimationFrame(() => {
      scrollToLatestMessage();
      secondFrame = window.requestAnimationFrame(scrollToLatestMessage);
    });
    const delayedScroll = window.setTimeout(scrollToLatestMessage, 150);
    const resizeObserver = new ResizeObserver(scrollToLatestMessage);

    resizeObserver.observe(timeline);

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) {
        window.cancelAnimationFrame(secondFrame);
      }
      window.clearTimeout(delayedScroll);
      resizeObserver.disconnect();
    };
  }, [latestMessageId, messages.length]);

  const renderedMessages = useMemo(
    () => [...messages].reverse().map((message) => <MessageBubble key={message.id} message={message} />),
    [messages]
  );

  return (
    <div ref={timelineRef} className="message-timeline message-timeline-latest-first">
      {renderedMessages}
    </div>
  );
}
