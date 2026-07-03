// 이메일 커넥터 — Gmail API + OAuth "installed app / loopback" 방식.
//   - 로그인: 구글 동의 URL을 브라우저로 열고, 사용자가 승인하면 loopback(127.0.0.1)으로 code가 돌아온다.
//     그 code를 refresh_token 으로 교환해 .auth/email[--label]/token.json 에 로컬 저장(★서버로 안 감).
//   - fetch: Gmail REST(messages.list + messages.get)로 최근 메일을 읽어 스레드별로 묶어 ChatRawConversation[]
//     로 정규화(스레드=Gmail thread, 메시지=개별 메일, direction=보낸사람이 나면 outbound).
//   - send: messages.send + In-Reply-To/References 로 같은 스레드에 답장.
//   ★의존성 0 — 표준 HTTPS(fetch)만 사용. OAuth 토큰 교환/갱신도 표준 POST.
//
// 콜백 URL은 http://127.0.0.1:<port>/oauth/callback — 이 라우팅은 마법사 서버(web/server.ts)가 캐치한다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ChatRawConversation, ChatRawMessage } from "@qualiflow/adapter-chat";

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
// readonly = 인박스 읽기, gmail.send = 발송. 최소 권한만 요청.
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"];
const FETCH_LIMIT = Number(process.env.QUALIFLOW_EMAIL_LIMIT) || 50; // 최근 메일 수(스레드 아님, 메일 기준)

function getOAuthCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GMAIL_CLIENT_ID ?? "";
  const clientSecret = process.env.GMAIL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET 가 없습니다. apps/web/.env.local 에 넣으세요.");
  }
  return { clientId, clientSecret };
}

// ── 토큰 로컬 저장 (★서버로 안 감) ──
type StoredToken = { refresh_token: string; email?: string };
function tokenFile(sessionDir: string): string {
  return resolve(sessionDir, "token.json");
}
async function loadToken(sessionDir: string): Promise<StoredToken | null> {
  try {
    return JSON.parse(await readFile(tokenFile(sessionDir), "utf8")) as StoredToken;
  } catch {
    return null;
  }
}
async function saveToken(sessionDir: string, token: StoredToken): Promise<void> {
  await mkdir(sessionDir, { recursive: true });
  await writeFile(tokenFile(sessionDir), `${JSON.stringify(token, null, 2)}\n`, "utf8");
}

// ── OAuth ──

// 동의 URL 생성. redirectUri = 마법사 loopback 콜백(포트는 마법사 서버가 정해서 넘긴다).
//   access_type=offline + prompt=consent 로 refresh_token 을 확실히 받는다.
export function buildAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = getOAuthCreds();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

// 콜백으로 받은 code → refresh_token 교환. 사용자 이메일 주소도 함께 얻어 저장(direction 판정용).
export async function exchangeCode(sessionDir: string, code: string, redirectUri: string): Promise<void> {
  const { clientId, clientSecret } = getOAuthCreds();
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    }).toString()
  });
  const data = (await res.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; error?: string };
  if (!res.ok || !data.refresh_token) {
    // refresh_token 이 없으면(이미 승인한 앱을 재승인해서 안 준 경우 등) 저장 불가 — 재동의 필요.
    throw new Error(
      `토큰 교환 실패: ${data.error ?? `HTTP ${res.status}`}. (refresh_token 미수신 — 구글 계정의 앱 권한을 지우고 다시 시도하세요.)`
    );
  }
  const email = data.access_token ? await fetchProfileEmail(data.access_token).catch(() => undefined) : undefined;
  await saveToken(sessionDir, { refresh_token: data.refresh_token, email });
  console.log(`✅ 이메일 로그인 완료 — refresh_token 을 로컬에 저장했습니다${email ? ` (${email})` : ""}.`);
}

// refresh_token → 단기 access_token(매 fetch/send 앞에서 갱신). access_token 은 저장하지 않는다.
async function getAccessToken(sessionDir: string): Promise<{ accessToken: string; email?: string }> {
  const stored = await loadToken(sessionDir);
  if (!stored?.refresh_token) {
    throw new Error("이메일 세션이 없습니다. 먼저 마법사에서 이메일을 로그인(연결)하세요.");
  }
  const { clientId, clientSecret } = getOAuthCreds();
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: stored.refresh_token,
      grant_type: "refresh_token"
    }).toString()
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`access_token 갱신 실패: ${data.error ?? `HTTP ${res.status}`}. 재로그인이 필요할 수 있습니다.`);
  }
  return { accessToken: data.access_token, email: stored.email };
}

async function fetchProfileEmail(accessToken: string): Promise<string | undefined> {
  const res = await fetch(`${GMAIL_API}/profile`, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = (await res.json().catch(() => ({}))) as { emailAddress?: string };
  return data.emailAddress;
}

// ── Gmail 파싱 헬퍼 ──
type GmailHeader = { name?: string; value?: string };
type GmailPart = { mimeType?: string; body?: { data?: string; size?: number }; parts?: GmailPart[] };
type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string; // epoch ms(문자열)
  payload?: { headers?: GmailHeader[] } & GmailPart;
};

function header(headers: GmailHeader[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name?.toLowerCase() === lower)?.value ?? "";
}

// "Name <a@b.com>" 또는 "a@b.com" 에서 이메일 주소만 뽑아 소문자화. 파싱 실패면 원문 트림.
function parseAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}
// From 헤더에서 표시 이름을 뽑는다(없으면 이메일 앞부분). "Name <a@b>" → Name, "a@b" → a.
function parseDisplayName(value: string): string {
  const angle = value.indexOf("<");
  if (angle > 0) {
    return value.slice(0, angle).replace(/^"|"$/g, "").trim() || parseAddress(value);
  }
  return parseAddress(value).split("@")[0] || value.trim();
}

// base64url → 텍스트. Gmail 은 body.data 를 base64url 로 준다.
function decodeBody(data: string | undefined): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

// 메일 본문에서 text/plain 을 우선 뽑는다(멀티파트 재귀). plain 없으면 html 을 태그 제거해서.
function extractText(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const plain = findPart(payload, "text/plain");
  if (plain) return decodeBody(plain.body?.data).trim();
  const html = findPart(payload, "text/html");
  if (html) {
    return decodeBody(html.body?.data)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
  return decodeBody(payload.body?.data).trim();
}
function findPart(part: GmailPart, mimeType: string): GmailPart | undefined {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const sub of part.parts ?? []) {
    const found = findPart(sub, mimeType);
    if (found) return found;
  }
  return undefined;
}

// ── fetch ──
export async function fetchEmail(sessionDir: string): Promise<ChatRawConversation[]> {
  const { accessToken, email: myEmail } = await getAccessToken(sessionDir);
  const auth = { authorization: `Bearer ${accessToken}` };

  // 최근 메일 목록(id만). 스팸/휴지통 제외는 Gmail 기본(list 는 기본적으로 그것들을 안 준다).
  const listRes = await fetch(`${GMAIL_API}/messages?maxResults=${FETCH_LIMIT}`, { headers: auth });
  const list = (await listRes.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: unknown };
  if (!listRes.ok) {
    throw new Error(`Gmail 목록 조회 실패: HTTP ${listRes.status}`);
  }
  const ids = (list.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));

  // 각 메일 상세를 받아 threadId 로 묶는다. 한 건 실패는 그 건만 건너뛴다(전체 fetch는 계속).
  const byThread = new Map<string, { messages: ChatRawMessage[]; contactName: string; contactId: string }>();
  for (const id of ids) {
    try {
      const msgRes = await fetch(`${GMAIL_API}/messages/${id}?format=full`, { headers: auth });
      if (!msgRes.ok) continue;
      const msg = (await msgRes.json()) as GmailMessage;
      const headers = msg.payload?.headers;
      const from = header(headers, "From");
      const fromAddr = parseAddress(from);
      const direction: ChatRawMessage["direction"] = myEmail && fromAddr === myEmail ? "outbound" : "inbound";
      const text = extractText(msg.payload);
      const subject = header(headers, "Subject");
      // 스레드 첫 표시에 제목이 보이게, 텍스트 앞에 제목을 얹는다(제목은 스레드 맥락이라 유용).
      const body = subject && text ? `${subject}\n\n${text}` : subject || text;
      if (!body) continue; // 본문/제목 둘 다 없으면 건너뜀

      const threadId = msg.threadId ?? id;
      const entry = byThread.get(threadId) ?? {
        messages: [],
        // 상대(고객)는 inbound 발신자. 스레드 이름/연락처는 첫 inbound 발신자로 잡는다.
        contactName: direction === "inbound" ? parseDisplayName(from) : "",
        contactId: direction === "inbound" ? fromAddr : ""
      };
      // 아직 상대 정보가 없고 이번이 inbound 면 채운다.
      if (!entry.contactId && direction === "inbound") {
        entry.contactName = parseDisplayName(from);
        entry.contactId = fromAddr;
      }
      entry.messages.push({
        id: msg.id ?? id,
        text: body,
        sentAt: new Date(Number(msg.internalDate) || Date.now()).toISOString(),
        direction
      });
      byThread.set(threadId, entry);
    } catch {
      // 이 메일만 건너뛴다.
    }
  }

  const conversations: ChatRawConversation[] = [];
  for (const [threadId, entry] of byThread) {
    if (!entry.messages.length) continue;
    entry.messages.sort((a, b) => a.sentAt.localeCompare(b.sentAt)); // 오래된 → 최신
    // 상대가 outbound-only 스레드(내가 먼저 보낸)면 To 주소가 상대지만, 여기선 inbound 없으면 threadId 로 대체.
    const contactId = entry.contactId || threadId;
    conversations.push({
      threadId,
      contact: { id: contactId, name: entry.contactName || contactId },
      messages: entry.messages
    });
  }
  return conversations;
}

// ── send ──
// 답장을 같은 Gmail 스레드에 넣는다. recipient = 불러온 대화의 contactId(=상대 이메일 주소).
//   In-Reply-To/References 헤더로 스레드를 유지하고, threadId 로 Gmail 스레드에 붙인다.
//   ★threadId 를 받으면(웹 답장이 원본 스레드를 실어 보낼 때) 그 스레드에 정확히 회신한다. 없으면
//   상대 주소로 '가장 최근' 메일을 찾는 근사 방식으로 폴백한다(같은 상대와 스레드가 여러 개면
//   최근 것이 아닐 수 있어 오배송 가능 — threadId 를 실으면 이 한계가 사라진다).
export async function sendEmail(
  sessionDir: string,
  recipient: string,
  text: string,
  threadId?: string
): Promise<void> {
  const { accessToken, email: myEmail } = await getAccessToken(sessionDir);
  const auth = { authorization: `Bearer ${accessToken}` };

  // 회신 대상 메일 하나를 고른다: threadId 가 있으면 그 스레드의 최신 메일, 없으면 상대 주소로 검색.
  let lastId: string | undefined;
  if (threadId) {
    // 스레드의 메일 목록 → 마지막(최신) 메일을 In-Reply-To 기준으로 삼는다.
    const threadRes = await fetch(`${GMAIL_API}/threads/${threadId}?format=minimal`, { headers: auth });
    if (threadRes.ok) {
      const thread = (await threadRes.json().catch(() => ({}))) as { messages?: { id?: string }[] };
      lastId = thread.messages?.[thread.messages.length - 1]?.id;
    }
  } else {
    // 폴백: 상대 주소로 최근 스레드를 찾는다(정확도 한계 — 위 주석 참고).
    const q = encodeURIComponent(`from:${recipient} OR to:${recipient}`);
    const searchRes = await fetch(`${GMAIL_API}/messages?q=${q}&maxResults=1`, { headers: auth });
    const search = (await searchRes.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    lastId = search.messages?.[0]?.id;
  }

  let replyThreadId: string | undefined = threadId;
  let subject = "";
  let inReplyTo = "";
  if (lastId) {
    const msgRes = await fetch(`${GMAIL_API}/messages/${lastId}?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-Id&metadataHeaders=References`, {
      headers: auth
    });
    if (msgRes.ok) {
      const msg = (await msgRes.json()) as GmailMessage;
      replyThreadId = msg.threadId ?? replyThreadId;
      subject = header(msg.payload?.headers, "Subject");
      inReplyTo = header(msg.payload?.headers, "Message-Id");
    }
  }
  if (subject && !/^re:/i.test(subject)) subject = `Re: ${subject}`;
  if (!subject) subject = "(no subject)";

  // RFC822 메시지를 조립해 base64url 로 인코딩. from 은 내 주소(있으면), 없으면 생략(Gmail이 채움).
  const lines = [
    `To: ${recipient}`,
    myEmail ? `From: ${myEmail}` : "",
    `Subject: ${subject}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
    inReplyTo ? `References: ${inReplyTo}` : "",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text
  ].filter((l) => l !== "");
  const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const sendRes = await fetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(replyThreadId ? { raw, threadId: replyThreadId } : { raw })
  });
  if (!sendRes.ok) {
    const err = await sendRes.text().catch(() => "");
    throw new Error(`이메일 발송 실패: HTTP ${sendRes.status} ${err.slice(0, 200)}`);
  }
  console.log(`📤 이메일 발송 완료 → ${recipient}`);
}
