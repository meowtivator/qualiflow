"use client";

import { useState } from "react";
import { Send } from "lucide-react";

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

export function ReplyDraft(props: ReplyDraftProps) {
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<string | null>(null);

  async function generate() {
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

  const badge = modeLabel(mode);

  return (
    <div className="reply-draft">
      <div className="reply-draft-header">
        <div className="reply-draft-copy">
          <span>답변 초안{badge ? <small> · {badge}</small> : null}</span>
          <p>{props.recommendedNextAction ?? "다음 액션을 확인한 뒤 답변을 작성합니다."}</p>
        </div>
        <button className="send-button" type="button" onClick={generate} disabled={loading}>
          <Send size={16} />
          <span>{loading ? "생성 중..." : "초안 생성"}</span>
        </button>
      </div>
      <textarea
        className="reply-textarea"
        onChange={(event) => setDraft(event.target.value)}
        placeholder="‘초안 생성’을 누르면 AI(또는 기본 템플릿) 답변이 여기에 들어옵니다. (API 키가 없으면 자동으로 템플릿)"
        value={draft}
      />
    </div>
  );
}
