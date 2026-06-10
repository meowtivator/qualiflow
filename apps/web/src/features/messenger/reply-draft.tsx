"use client";

import { useState } from "react";
import { Send } from "lucide-react";

type ReplyDraftProps = {
  leadName: string;
  channelLabel: string;
  recommendedNextAction?: string;
  qualificationSummary?: string;
};

function buildMockDraft({ leadName, channelLabel, recommendedNextAction, qualificationSummary }: ReplyDraftProps) {
  const action = recommendedNextAction ?? "Could you share a few more details so we can review the next step?";
  const context = qualificationSummary ? `\n\nContext: ${qualificationSummary}` : "";

  return `Hi ${leadName},

Thank you for your message through ${channelLabel}. ${action}

Please let us know if there are specific products, target volume, or sample requirements we should consider.${context}`;
}

export function ReplyDraft(props: ReplyDraftProps) {
  const [draft, setDraft] = useState("");

  return (
    <div className="reply-draft">
      <div className="reply-draft-header">
        <div className="reply-draft-copy">
          <span>답변 초안</span>
          <p>{props.recommendedNextAction ?? "다음 액션을 확인한 뒤 답변을 작성합니다."}</p>
        </div>
        <button className="send-button" type="button" onClick={() => setDraft(buildMockDraft(props))}>
          <Send size={16} />
          <span>초안 작성</span>
        </button>
      </div>
      <textarea
        className="reply-textarea"
        onChange={(event) => setDraft(event.target.value)}
        placeholder="초안 작성 버튼을 누르면 mock 답변이 여기에 들어옵니다."
        value={draft}
      />
    </div>
  );
}
