import { NextResponse } from "next/server";

// 답변 초안 생성 (제품 속 AI = 언어 생성). 등급 판정은 스코어링(score.ts)이 하고,
// LLM은 여기 "답장 글쓰기"에만 쓴다(역할 분리).
//
// 환경변수(서버 전용, 코드에 키 넣지 말 것):
//   OPENAI_API_KEY   — 없으면 템플릿 폴백(키 없이도 동작 → 채점자 실행 보장)
//   OPENAI_BASE_URL  — 기본 https://api.openai.com/v1 (로컬 LM Studio면 http://localhost:1234/v1)
//   OPENAI_MODEL     — 기본 gpt-4o-mini
export const runtime = "nodejs";

type DraftRequest = {
  leadName?: string;
  channelLabel?: string;
  buyerMessage?: string;
  recommendedNextAction?: string;
  qualificationSummary?: string;
};

// 키가 없거나 실패했을 때의 기본 템플릿(생성형 AI 없이도 항상 무언가 돌려준다).
function templateDraft(body: DraftRequest): string {
  const action = body.recommendedNextAction ?? "Could you share a few more details so we can review the next step?";
  const context = body.qualificationSummary ? `\n\n(Context: ${body.qualificationSummary})` : "";
  return `Hi ${body.leadName ?? "there"},

Thank you for your message via ${body.channelLabel ?? "your channel"}. ${action}

Please let us know your target products, volume, and any sample requirements so we can assist further.${context}`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as DraftRequest;
  const apiKey = process.env.OPENAI_API_KEY;
  const fallback = templateDraft(body);

  // 키 없음 → 템플릿 폴백 (키 없이도 핵심 흐름이 끝까지 동작)
  if (!apiKey) {
    return NextResponse.json({ mode: "fallback", model: null, draft: fallback });
  }

  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "You are a B2B cosmetics export sales assistant. Write a concise, professional English reply draft (3-5 sentences) to a buyer's inquiry. Do NOT invent facts such as prices, MOQ, or lead times that were not provided — if needed, politely ask for them. Keep a warm, business tone. Output only the reply text, no preamble."
          },
          {
            role: "user",
            content: `Buyer: ${body.leadName ?? "buyer"} (via ${body.channelLabel ?? "inbound channel"}).
Their message: "${body.buyerMessage ?? "(no message text available)"}"
Internal context: ${body.qualificationSummary ?? "n/a"}; suggested next action: ${body.recommendedNextAction ?? "n/a"}.`
          }
        ]
      })
    });

    if (!response.ok) {
      return NextResponse.json({ mode: "fallback_after_error", model, draft: fallback, error: `LLM ${response.status}` });
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const draft = data.choices?.[0]?.message?.content?.trim();
    return NextResponse.json({ mode: draft ? "llm" : "fallback", model, draft: draft || fallback });
  } catch (error) {
    return NextResponse.json({
      mode: "fallback_after_error",
      model,
      draft: fallback,
      error: error instanceof Error ? error.message : "unknown error"
    });
  }
}
