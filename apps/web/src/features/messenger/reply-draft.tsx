"use client";

import { useState } from "react";
import { Send, Sparkles } from "lucide-react";

type ReplyDraftProps = {
  leadName: string;
  channelLabel: string;
  recommendedNextAction?: string;
  qualificationSummary?: string;
  threadId: string;
};

// '초안 채우기' 보조용 — 실제 발송이 아니라 텍스트박스를 채우는 헬퍼다(사람이 다듬어 보낸다).
function buildMockDraft({ leadName, channelLabel, recommendedNextAction, qualificationSummary }: ReplyDraftProps) {
  const action = recommendedNextAction ?? "Could you share a few more details so we can review the next step?";
  const context = qualificationSummary ? `\n\nContext: ${qualificationSummary}` : "";

  return `Hi ${leadName},

Thank you for your message through ${channelLabel}. ${action}

Please let us know if there are specific products, target volume, or sample requirements we should consider.${context}`;
}

type SendState = "idle" | "sending" | "sent" | "error";

export function ReplyDraft(props: ReplyDraftProps) {
  const [draft, setDraft] = useState("");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendError, setSendError] = useState("");

  const canSend = draft.trim().length > 0 && sendState !== "sending";

  const handleSend = async () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    setSendState("sending");
    setSendError("");
    try {
      const response = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: props.threadId, text })
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setSendState("error");
        setSendError(data.message ?? "발송 요청에 실패했습니다.");
        return;
      }
      setSendState("sent");
      setDraft("");
    } catch (error) {
      setSendState("error");
      setSendError(error instanceof Error ? error.message : "발송 요청에 실패했습니다.");
    }
  };

  return (
    <div className="reply-draft">
      <div className="reply-draft-header">
        <div className="reply-draft-copy">
          <span>답변</span>
          <p>{props.recommendedNextAction ?? "에이전트가 연결된 채널 계정으로 실제 발송합니다."}</p>
        </div>
        <button
          className="connector-connect-button secondary"
          type="button"
          onClick={() => {
            setDraft(buildMockDraft(props));
            setSendState("idle");
          }}
        >
          <Sparkles size={16} />
          <span>초안 채우기</span>
        </button>
      </div>
      <textarea
        className="reply-textarea"
        onChange={(event) => {
          setDraft(event.target.value);
          if (sendState !== "idle") {
            setSendState("idle");
          }
        }}
        placeholder="답변을 입력하거나 '초안 채우기'로 시작하세요. '보내기'를 누르면 에이전트가 채널로 전송합니다."
        value={draft}
      />
      <div className="reply-draft-actions">
        {sendState === "sent" ? (
          <span className="reply-send-feedback ok">전송 요청을 보냈습니다 — 실행 중인 에이전트가 채널로 발송합니다.</span>
        ) : null}
        {sendState === "error" ? <span className="reply-send-feedback error">{sendError}</span> : null}
        <button className="send-button" type="button" disabled={!canSend} onClick={() => void handleSend()}>
          <Send size={16} />
          <span>{sendState === "sending" ? "보내는 중..." : "보내기"}</span>
        </button>
      </div>
    </div>
  );
}
