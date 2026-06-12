import type {
  ConversationAdapter,
  Lead,
  LeadGrade,
  LeadQualification,
  Message
} from "@qualiflow/core";

// ────────────────────────────────────────────────────────────────────────
// 리드 등급 스코어링 (v0 — QA로 튜닝할 임시 비즈니스 규칙)
//
// 등급(A/B/C)은 LLM이 아니라 "신호 가중치 합산"으로 결정적으로 매긴다.
//  - 장점: 같은 입력 = 같은 결과, 점수 내역이 곧 근거(설명 가능), 무료/즉시(키 불필요).
//  - LLM은 등급이 아니라 "답변 초안" 등 언어 생성에 쓴다(역할 분리).
// 가중치·임계값은 소유자가 정하는 비즈니스 규칙이며, 평가셋 QA로 조정한다.
// ────────────────────────────────────────────────────────────────────────

const WEIGHTS = {
  purchaseIntent: 3, // 수량·예산·견적·주문 등 명확한 구매의향
  beautyBusiness: 2, // 뷰티/화장품 관련 업종
  localShop: 2, // 자사 매장·유통·소매
  website: 1, // 자사몰/웹사이트
  sampleInterest: 1 // 샘플 제안·관심
} as const;

const GRADE_A_MIN = 3; // 합계 ≥ 3 → A
const GRADE_B_MIN = 1; // 1~2 → B,  그 외 → C

const PATTERNS = {
  beautyBusiness: /beauty|cosmetic|skin\s?care|derma|clinic|salon|spa|aesthetic|esthetic|화장품|뷰티|피부|에스테틱|클리닉|살롱/i,
  localShop: /\bshop\b|store|retail|boutique|distribut|wholesale|매장|샵|소매|도매|유통/i,
  website: /https?:\/\/|www\.|\.com\b|\.co\b|shopify|자사몰|온라인몰/i,
  purchaseIntent: /\b\d{2,}\s*(units?|pcs|pieces|tons?|kg|개|box(es)?|박스)|\b(quote|quotation|order|moq|budget|pricing)\b|구매|견적|주문|수량|예산|발주/i,
  sampleInterest: /\bsamples?\b|샘플/i,
  spam: /\bspam\b|casino|crypto|\bloan\b|\bseo\b|ranking service|marketing agency|promote your (brand|product)|광고\s*대행|홍보\s*대행|마케팅\s*대행/i
} as const;

const LABELS: Record<keyof typeof WEIGHTS, string> = {
  purchaseIntent: "명확한 구매의향(수량·견적)",
  beautyBusiness: "관련 업종(뷰티/화장품)",
  localShop: "자사 매장·유통",
  website: "자사 웹사이트",
  sampleInterest: "샘플 관심"
};

function gradeFromScore(score: number): LeadGrade {
  if (score >= GRADE_A_MIN) return "A";
  if (score >= GRADE_B_MIN) return "B";
  return "C";
}

function nextAction(grade: LeadGrade): string {
  if (grade === "A") return "우선 응대: 샘플/견적 등 다음 단계를 제안하세요.";
  if (grade === "B") return "업종·규모·구매의향을 확인하는 질문을 보내세요.";
  return "영업 대상에서 제외하고 지표 집계용으로만 유지하세요.";
}

// 한 리드를 점수화 → core LeadQualification.
export function scoreLead(lead: Lead, messages: Message[]): LeadQualification {
  const inbound = messages
    .filter((message) => message.direction === "inbound")
    .map((message) => message.content.text);
  const haystack = [lead.companyName, lead.countryName, lead.displayName, ...inbound]
    .filter(Boolean)
    .join(" ");

  const reasons: string[] = [];
  const missingEvidence: string[] = [];
  let score = 0;

  const spam = PATTERNS.spam.test(haystack);
  if (spam) {
    reasons.push("광고/스팸성 신호 감지 → C 강제");
  }

  for (const key of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
    if (PATTERNS[key].test(haystack)) {
      score += WEIGHTS[key];
      reasons.push(`${LABELS[key]} +${WEIGHTS[key]}`);
    } else {
      missingEvidence.push(LABELS[key]);
    }
  }

  const grade: LeadGrade = spam ? "C" : gradeFromScore(score);
  const confidence = spam || score >= 4 ? "high" : score >= GRADE_B_MIN ? "medium" : "low";
  const summary = spam
    ? "광고/스팸성 신호로 C로 분류했습니다."
    : `신호 점수 ${score}점 → ${grade}${grade === "C" ? " (뚜렷한 구매 신호 없음)" : ""}`;

  return {
    id: `qual_${lead.id}`,
    leadId: lead.id,
    grade,
    confidence,
    summary,
    reasons,
    missingEvidence: grade === "A" ? [] : missingEvidence,
    recommendedNextAction: nextAction(grade),
    visibility: "internal",
    evaluatedBy: "rule",
    evaluatedAt: new Date().toISOString()
  };
}

// 어댑터의 모든 리드를 점수화 → Map<leadId, LeadQualification>.
// (스레드별 메시지를 모아 리드 단위로 합산한다)
export async function scoreAllLeads(
  adapter: ConversationAdapter,
  leads: Lead[]
): Promise<Map<string, LeadQualification>> {
  const threadPage = await adapter.listThreads();
  const messagesByLead = new Map<string, Message[]>();

  for (const thread of threadPage.items) {
    const page = await adapter.listMessages({ threadId: thread.id });
    const existing = messagesByLead.get(thread.leadId) ?? [];
    existing.push(...page.items);
    messagesByLead.set(thread.leadId, existing);
  }

  const result = new Map<string, LeadQualification>();
  for (const lead of leads) {
    result.set(lead.id, scoreLead(lead, messagesByLead.get(lead.id) ?? []));
  }
  return result;
}
