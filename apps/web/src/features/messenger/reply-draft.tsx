"use client";

import { useState } from "react";
import { Send, Sparkles } from "lucide-react";

type ReplyDraftProps = {
  leadName: string;
  channelLabel: string;
  buyerMessage?: string;
  recommendedNextAction?: string;
  qualificationSummary?: string;
};

type DraftResponse = { draft?: string; mode?: string };

function modeLabel(mode: string | null): string | null {
  if (mode === "llm") return "AI 생성";
  if (mode === "fallback" || mode === "fallback_after_error") return "기본 템플릿";
  if (mode === "error") return "오류";
  return null;
}

const buttonBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  padding: "11px 16px",
  borderRadius: "9px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer"
} as const;

export function ReplyDraft(props: ReplyDraftProps) {
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function generate() {
    setStatus("");
    setLoading(true);
    try {
      const response = await fetch("/api/reply-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadName: props.leadName,
          channelLabel: props.channelLabel,
          buyerMessage: props.buyerMessage,
          recommendedNextAction: props.recommendedNextAction,
          qualificationSummary: props.qualificationSummary
        })
      });
      const data = (await response.json()) as DraftResponse;
      setDraft(data.draft ?? "");
      setMode(data.mode ?? null);
    } catch {
      setDraft("초안 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      setMode("error");
    } finally {
      setLoading(false);
    }
  }

  function send() {
    if (!draft.trim()) {
      setStatus("먼저 ‘AI 초안 생성’을 누르거나 답변을 직접 작성하세요.");
      return;
    }
    setStatus("✅ 전송되었습니다 (데모 — 실제 채널 전송은 향후 연동 예정).");
  }

  const badge = modeLabel(mode);

  return (
    <div className="reply-draft">
      <div className="reply-draft-copy">
        <span>답변 초안{badge ? ` · ${badge}` : ""}</span>
        <p>{props.recommendedNextAction ?? "AI가 바이어 메시지를 읽고 답변 초안을 만들어줍니다."}</p>
      </div>

      <textarea
        className="reply-textarea"
        onChange={(event) => setDraft(event.target.value)}
        placeholder="‘AI 초안 생성’을 누르면 답변이 여기에 들어옵니다. 직접 수정한 뒤 ‘전송’하세요. (API 키가 없으면 자동 템플릿)"
        value={draft}
      />

      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          style={{
            ...buttonBase,
            flex: 1,
            border: "1.5px solid var(--primary, #5b6ef5)",
            background: "#ffffff",
            color: "var(--primary, #5b6ef5)",
            opacity: loading ? 0.6 : 1
          }}
        >
          <Sparkles size={16} />
          {loading ? "생성 중…" : "AI 초안 생성"}
        </button>
        <button
          type="button"
          onClick={send}
          style={{
            ...buttonBase,
            border: 0,
            background: "var(--primary, #5b6ef5)",
            color: "#ffffff"
          }}
        >
          <Send size={16} />
          전송
        </button>
      </div>

      {status ? <p style={{ marginTop: "8px", fontSize: "12.5px", color: "#4b5563" }}>{status}</p> : null}
    </div>
  );
}
