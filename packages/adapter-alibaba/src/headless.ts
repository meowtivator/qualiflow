import type { AlibabaDiscoveryCandidate, AlibabaDiscoveryTarget, AlibabaInboundBuyer } from "./index.js";
import { buildAlibabaDiscoveryCandidates } from "./index.js";
import type { AlibabaContactMetadata } from "./normalize.js";
import { URL } from "node:url";

type AnchorLink = {
  href: string;
  text: string;
};

export type AlibabaHeadlessDiscoveryMatch = {
  title: string;
  url: string;
  sourceDomain: string;
};

export type AlibabaHeadlessDiscoveryStatus = "matched" | "no_match" | "blocked" | "error";

export type AlibabaHeadlessCandidateResult = {
  candidate: AlibabaDiscoveryCandidate;
  status: AlibabaHeadlessDiscoveryStatus;
  matches: AlibabaHeadlessDiscoveryMatch[];
  errorMessage?: string;
};

export type AlibabaHeadlessBuyerReport = {
  buyer: AlibabaInboundBuyer;
  results: AlibabaHeadlessCandidateResult[];
};

export type AlibabaHeadlessDiscoveryOptions = {
  headless?: boolean;
  browserChannel?: "chrome" | "msedge" | "chromium";
  executablePath?: string;
  timeoutMs?: number;
  navigationWaitUntil?: "domcontentloaded" | "load" | "networkidle";
  maxCandidatesPerBuyer?: number;
  maxMatchesPerCandidate?: number;
  delayBetweenCandidatesMs?: number;
};

const TARGET_DOMAINS: Record<AlibabaDiscoveryTarget, string[]> = {
  web: [],
  instagram: ["instagram.com"],
  linkedin: ["linkedin.com"],
  facebook: ["facebook.com"]
};

const BLOCKED_PAGE_PATTERNS = ["unusual traffic", "captcha", "verify you are human", "detected unusual"];

function normalizeDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isTargetMatch(target: AlibabaDiscoveryTarget, url: string) {
  const domain = normalizeDomain(url);

  if (!domain) {
    return false;
  }

  if (target === "web") {
    return !["google.com", "bing.com", "duckduckgo.com"].some((blockedDomain) => domain.endsWith(blockedDomain));
  }

  return TARGET_DOMAINS[target].some((targetDomain) => domain === targetDomain || domain.endsWith(`.${targetDomain}`));
}

export function extractAlibabaDiscoveryMatches(
  candidate: AlibabaDiscoveryCandidate,
  links: AnchorLink[],
  maxMatches = 3
): AlibabaHeadlessDiscoveryMatch[] {
  const matches: AlibabaHeadlessDiscoveryMatch[] = [];
  const seenUrls = new Set<string>();

  for (const link of links) {
    const href = link.href.trim();

    if (!href || seenUrls.has(href) || !isTargetMatch(candidate.target, href)) {
      continue;
    }

    seenUrls.add(href);
    matches.push({
      title: link.text.trim().replace(/\s+/g, " ").slice(0, 180) || href,
      url: href,
      sourceDomain: normalizeDomain(href)
    });

    if (matches.length >= maxMatches) {
      break;
    }
  }

  return matches;
}

async function collectAnchorLinks(page: import("playwright-core").Page): Promise<AnchorLink[]> {
  return page.locator("a[href]").evaluateAll((anchors) =>
    anchors
      .map((anchor) => ({
        href: anchor.getAttribute("href") ?? "",
        text: anchor.textContent ?? ""
      }))
      .filter((link) => link.href)
  );
}

async function delay(ms: number) {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAlibabaHeadlessDiscovery(
  buyers: AlibabaInboundBuyer[],
  options: AlibabaHeadlessDiscoveryOptions = {}
): Promise<AlibabaHeadlessBuyerReport[]> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    headless: options.headless ?? true,
    channel: options.executablePath ? undefined : options.browserChannel,
    executablePath: options.executablePath
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();
    const reports: AlibabaHeadlessBuyerReport[] = [];

    for (const buyer of buyers) {
      const candidates = buildAlibabaDiscoveryCandidates(buyer).slice(0, options.maxCandidatesPerBuyer ?? 12);
      const results: AlibabaHeadlessCandidateResult[] = [];

      for (const candidate of candidates) {
        try {
          await page.goto(candidate.url, {
            waitUntil: options.navigationWaitUntil ?? "domcontentloaded",
            timeout: options.timeoutMs ?? 12_000
          });

          const bodyText = (await page.locator("body").innerText({ timeout: options.timeoutMs ?? 12_000 })).toLowerCase();
          const isBlocked = BLOCKED_PAGE_PATTERNS.some((pattern) => bodyText.includes(pattern));

          if (isBlocked) {
            results.push({
              candidate,
              status: "blocked",
              matches: [],
              errorMessage: "Search page appears to require human verification."
            });
          } else {
            const links = await collectAnchorLinks(page);
            const matches = extractAlibabaDiscoveryMatches(candidate, links, options.maxMatchesPerCandidate ?? 3);

            results.push({
              candidate,
              status: matches.length > 0 ? "matched" : "no_match",
              matches
            });
          }
        } catch (error) {
          results.push({
            candidate,
            status: "error",
            matches: [],
            errorMessage: error instanceof Error ? error.message : "Unknown headless discovery error."
          });
        }

        await delay(options.delayBetweenCandidatesMs ?? 750);
      }

      reports.push({ buyer, results });
    }

    await context.close();

    return reports;
  } finally {
    await browser.close();
  }
}

// ────────────────────────────────────────────────────────────────────────
// SNS 디스커버리 통합 지점 (company+country → 후보 instagram/linkedin/facebook URL).
//
// ⚠️ 라이브 브라우저가 있어야 동작한다(웹 검색 페이지를 실제로 연다). 그래서 이 함수는
//    "통합 지점"으로만 둔다 — 라이브 세션이 없는 환경에선 호출하지 않는다(빈 결과를 가짜로 채우지 않음).
//
// 어떻게 끼우나(invocation):
//   추출(extractAlibaba)로 바이어 목록을 얻은 뒤, 라이브 브라우저가 가능한 에이전트(Node) 쪽에서
//   바이어별로 1회 호출한다. 반환된 sns 를 그 바이어의 ingest contact.metadata.sns 로 합쳐
//   서버 ingest_conversations 가 leads.lead_metadata 에 병합하게 한다. 예시(에이전트 push 흐름):
//
//     const sns = await discoverBuyerSns(
//       { company: c.contact.companyName, country: c.contact.complianceCountryCode, buyerName: c.contact.name },
//       { headless: true }
//     );
//     // 그런 다음 alibabaToIngestConversations 결과의 해당 contact.metadata 에 { sns } 를 머지.
//
// ★지금은 normalize 단계에서 자동 호출하지 않는다(브라우저가 없을 수 있고, 바이어 수백 명에
//   per-buyer 검색은 차단 위험·시간이 큼). 호출 정책(언제/몇 명에게)은 에이전트가 정한다.
export type DiscoverBuyerSnsInput = {
  company?: string;
  country?: string;
  buyerName?: string;
};

// 검색 대상 → metadata.sns 키 매핑. web 후보는 SNS 칸에 안 넣는다(별도 사이트).
const SNS_TARGET_TO_KEY: Partial<Record<AlibabaDiscoveryTarget, keyof NonNullable<AlibabaContactMetadata["sns"]>>> = {
  instagram: "instagram",
  linkedin: "linkedin",
  facebook: "facebook"
};

// 한 바이어에 대해 디스커버리를 돌려 후보 SNS URL을 고른다(각 채널당 첫 매치 1개).
// 매치가 하나도 없으면 undefined(→ metadata.sns 미포함). 절대 추측 URL을 만들지 않는다.
export async function discoverBuyerSns(
  input: DiscoverBuyerSnsInput,
  options: AlibabaHeadlessDiscoveryOptions = {}
): Promise<NonNullable<AlibabaContactMetadata["sns"]> | undefined> {
  // buildAlibabaDiscoveryCandidates 가 기대하는 최소 buyer 형태로 변환(검색에 쓰는 필드만 채움).
  const buyer: AlibabaInboundBuyer = {
    externalLeadId: input.buyerName || input.company || "unknown",
    buyerName: input.buyerName || input.company || "",
    companyName: input.company,
    countryCode: input.country,
    receivedAt: new Date(0).toISOString()
  };

  const [report] = await runAlibabaHeadlessDiscovery([buyer], options);
  if (!report) return undefined;

  const sns: NonNullable<AlibabaContactMetadata["sns"]> = {};
  for (const result of report.results) {
    const key = SNS_TARGET_TO_KEY[result.candidate.target];
    if (!key || result.status !== "matched") continue;
    const firstUrl = result.matches[0]?.url;
    if (firstUrl && !sns[key]) sns[key] = firstUrl; // 채널당 첫 매치만(가장 위 검색결과).
  }

  return Object.keys(sns).length > 0 ? sns : undefined;
}
