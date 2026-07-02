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

  // 컨테이너가 column-reverse(globals.css .message-timeline-latest-first)라 scrollTop 0 = 최신 메시지.
  // 브라우저 스크롤 앵커링이 0 위치를 유지해 주므로, 스레드 전환/새 메시지 때 리셋 한 번이면 충분하다
  // (기존 rAF×2 + 150ms 타이머 + ResizeObserver는 같은 일을 반복하던 벨트-앤-서스펜더).
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = 0;
    }
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
