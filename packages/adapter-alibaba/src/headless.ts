import type { AlibabaDiscoveryCandidate, AlibabaDiscoveryTarget, AlibabaInboundBuyer } from "./index.js";
import { buildAlibabaDiscoveryCandidates } from "./index.js";
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
