import type { Message, MessageAttachment } from "@qualiflow/core";

import { formatTime } from "./format";

type MessageBubbleProps = {
  message: Message;
};

// url이 아직(또는 영영) 없는 첨부 상태를 한국어 자리표시로. 미디어가 '있었다'는 사실은 항상 보존한다.
//   pending = 다운로드 대기(에이전트가 아직 업로드 전), skipped = 크기/형식 제한으로 안 받음,
//   error = 다운로드/업로드 실패. channel-url/stored 인데 url이 비면(이론상 없음) 그냥 자리표시.
const KIND_LABEL: Record<MessageAttachment["kind"], string> = {
  image: "사진",
  video: "영상",
  audio: "음성",
  file: "파일"
};

function placeholderText(att: MessageAttachment): string {
  const kind = KIND_LABEL[att.kind] ?? "첨부";
  if (att.source === "pending") return `${kind} (불러오는 중)`;
  if (att.source === "skipped") return `${kind} (크기·형식 제한으로 미수신)`;
  if (att.source === "error") return `${kind} (불러오기 실패)`;
  return `${kind}`;
}

// 첨부 하나를 렌더. url이 있으면 종류별로(이미지=<img>, 영상=<video>, 그 외=다운로드 링크),
// 없으면 자리표시 텍스트. 캡션은 있으면 아래에 덧붙인다.
function AttachmentItem({ att }: { att: MessageAttachment }) {
  const hasUrl = typeof att.url === "string" && att.url.length > 0;

  if (hasUrl && att.kind === "image") {
    return (
      <a className="message-attachment image" href={att.url} target="_blank" rel="noreferrer">
        {/* 채널/저장소 호스트의 원격 이미지라 next/image 최적화 대상이 아님 → 일반 img로 그대로 표시. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={att.url} alt={att.caption ?? att.fileName ?? "사진"} loading="lazy" />
      </a>
    );
  }

  if (hasUrl && att.kind === "video") {
    return (
      <video className="message-attachment video" src={att.url} controls preload="metadata">
        <track kind="captions" />
      </video>
    );
  }

  if (hasUrl) {
    // audio/file: 인라인 재생기 대신 안전하게 새 탭 다운로드 링크(형식이 다양해 일관된 표시가 쉬움).
    return (
      <a className="message-attachment file" href={att.url} target="_blank" rel="noreferrer">
        {KIND_LABEL[att.kind] ?? "첨부"}: {att.fileName ?? att.url}
      </a>
    );
  }

  // url 없음(pending/skipped/error 등) → 자리표시.
  return <span className="message-attachment placeholder">[{placeholderText(att)}]</span>;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const attachments = message.attachments ?? [];
  const text = message.content.text;

  return (
    <article className={`message-bubble ${message.direction}`}>
      <div className="message-header">
        <strong>{message.author.displayName}</strong>
        <span>{formatTime(message.sentAt)}</span>
      </div>
      {/* 텍스트가 비어 있으면(미디어-only 메시지) 빈 <p>를 안 그린다 — 첨부만 표시. */}
      {text ? <p>{text}</p> : null}
      {attachments.length > 0 ? (
        <div className="message-attachments">
          {attachments.map((att) => (
            <AttachmentItem key={att.id} att={att} />
          ))}
        </div>
      ) : null}
    </article>
  );
}
