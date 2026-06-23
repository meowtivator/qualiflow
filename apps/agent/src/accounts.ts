// 계정 등록부(다계정) — 채널마다 여러 계정을 두고, 계정별로 세션/데이터를 분리한다.
//   - 세션:  .auth/<base>            (default 계정 = 기존 경로, 하위호환)
//            .auth/<base>--<label>   (그 외 계정)
//   - 데이터: apps/web/.data/<channel>-conversations[.json | --<label>.json]
//   - 등록부: apps/web/.data/agent-accounts.json  (나중에 클라우드 channel_connections로 승격)

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");
const AUTH_ROOT = resolve(REPO_ROOT, ".auth");
const DATA_ROOT = resolve(REPO_ROOT, "apps/web/.data");
const REGISTRY = resolve(DATA_ROOT, "agent-accounts.json");

export const SUPPORTED_CHANNELS = ["alibaba", "whatsapp", "telegram"] as const;

export type Account = {
  channel: string;
  label: string;
  addedAt: string;
};

// 라벨 정규화(파일 경로에 안전하게). 한글/영숫자/_/- 만 남긴다.
export function sanitizeLabel(rawLabel: string): string {
  const cleaned = rawLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "default";
}

function sessionBase(channel: string): string {
  if (channel === "alibaba") return "alibaba-chrome-profile";
  if (channel === "whatsapp") return "whatsapp-baileys";
  return channel;
}

// 계정별 세션 경로. default 라벨은 기존(라벨 없는) 경로 = 하위호환.
export function sessionPath(channel: string, label: string): string {
  const base = sessionBase(channel);
  return label === "default" ? resolve(AUTH_ROOT, base) : resolve(AUTH_ROOT, `${base}--${label}`);
}

// 계정별 데이터 파일. default 라벨은 기존 파일명 = 하위호환 + 웹이 그대로 읽음.
export function dataFile(channel: string, label: string): string {
  return label === "default"
    ? resolve(DATA_ROOT, `${channel}-conversations.json`)
    : resolve(DATA_ROOT, `${channel}-conversations--${label}.json`);
}

export async function listAccounts(): Promise<Account[]> {
  try {
    const parsed = JSON.parse(await readFile(REGISTRY, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Account[]) : [];
  } catch {
    return [];
  }
}

async function saveAccounts(accounts: Account[]): Promise<void> {
  await mkdir(dirname(REGISTRY), { recursive: true });
  await writeFile(REGISTRY, `${JSON.stringify(accounts, null, 2)}\n`, "utf8");
}

export async function addAccount(channel: string, rawLabel: string): Promise<Account> {
  const label = sanitizeLabel(rawLabel);
  const accounts = await listAccounts();
  if (accounts.some((account) => account.channel === channel && account.label === label)) {
    throw new Error(`이미 등록된 계정입니다: ${channel}/${label}`);
  }
  const account: Account = { channel, label, addedAt: new Date().toISOString() };
  await saveAccounts([...accounts, account]);
  return account;
}

// 등록부에서 제거 + 그 계정의 세션·데이터 삭제.
export async function removeAccount(channel: string, rawLabel: string): Promise<void> {
  const label = sanitizeLabel(rawLabel);
  const accounts = await listAccounts();
  const next = accounts.filter((account) => !(account.channel === channel && account.label === label));
  if (next.length === accounts.length) {
    throw new Error(`등록되지 않은 계정입니다: ${channel}/${label}`);
  }
  await saveAccounts(next);
  await rm(sessionPath(channel, label), { recursive: true, force: true });
  await rm(dataFile(channel, label), { force: true });
}

// fetch 시 라벨 결정: 라벨 주면 그대로, 안 주면 그 채널 계정이 1개면 그것, 0개면 default, 여러 개면 에러.
export async function resolveLabel(channel: string, rawLabel: string | undefined): Promise<string> {
  if (rawLabel) {
    return sanitizeLabel(rawLabel);
  }
  const channelAccounts = (await listAccounts()).filter((account) => account.channel === channel);
  if (channelAccounts.length > 1) {
    throw new Error(
      `${channel} 계정이 여러 개입니다(${channelAccounts.map((a) => a.label).join(", ")}). 라벨을 지정하세요: fetch ${channel} <라벨>`
    );
  }
  return channelAccounts[0]?.label ?? "default";
}
