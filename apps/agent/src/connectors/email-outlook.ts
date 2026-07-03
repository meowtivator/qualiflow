// 이메일 커넥터(Outlook / Microsoft 365) — Microsoft identity platform v2.0 + Graph API.
//   email.ts(Gmail)와 export 시그니처가 완전히 동일하다(나중 배선이 대칭이 되도록). 차이는 엔드포인트/응답 모양뿐.
//   - 로그인: MS 동의 URL을 브라우저로 열고, 승인하면 loopback(127.0.0.1)으로 code가 돌아온다.
//     그 code를 refresh_token 으로 교환해 sessionDir/token.json 에 로컬 저장(★서버로 안 감).
//   - fetch: Graph /me/messages 로 최근 메일을 읽어 conversationId 로 묶어 ChatRawConversation[] 로 정규화
//     (스레드=Graph conversationId, direction=from 이 나면 outbound). email.ts 매핑 규칙 그대로.
//   - send: Graph /me/messages/{id}/reply(스레드 회신) 또는 /me/sendMail(신규) 로 발송.
//   ★의존성 0 — 표준 HTTPS(fetch)만 사용. OAuth 토큰 교환/갱신도 표준 POST.
//   ★client_secret 이 있는 confidential 앱이라 PKCE 는 생략(email.ts 방식 동일).
//
// 콜백 URL은 http://127.0.0.1:<port>/oauth/callback — 이 라우팅은 마법사 서버(web/server.ts)가 캐치한다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ChatRawConversation, ChatRawMessage } from "@qualiflow/adapter-chat";

// common 테넌트 = 개인/조직 계정 모두 허용. 특정 테넌트로 제한하려면 여기를 테넌트ID로.
const OAUTH_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const OAUTH_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_API = "https://graph.microsoft.com/v1.0";
// Mail.Read = 인박스 읽기, Mail.Send = 발송, offline_access = refresh_token, openid/email/profile = 내 주소 파악.
const SCOPES = ["Mail.Read", "Mail.Send", "offline_access", "openid", "email", "profile"];
const FETCH_LIMIT = Number(process.env.QUALIFLOW_EMAIL_LIMIT) || 50; // 최근 메일 수(스레드 아님, 메일 기준)

function getOAuthCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MS_CLIENT_ID ?? "";
  const clientSecret = process.env.MS_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("MS_CLIENT_ID / MS_CLIENT_SECRET 가 없습니다. apps/web/.env.local 에 넣으세요.");
  }
  return { clientId, clientSecret };
}

// ── 토큰 로컬 저장 (★서버로 안 감) ──
// email.ts StoredToken 과 호환(refresh_token, email) + provider 필드 추가.
type StoredToken = { refresh_token: string; email?: string; provider?: "outlook" };
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
//   offline_access 스코프로 refresh_token 을 받는다. prompt=select_account 로 계정 선택 화면을 띄운다.
export function buildAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = getOAuthCreds();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    response_mode: "query",
    prompt: "select_account",
    state
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

// 콜백으로 받은 code → refresh_token 교환. 내 이메일 주소도 Graph /me 로 얻어 저장(direction 판정용).
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
      scope: SCOPES.join(" "),
      grant_type: "authorization_code"
    }).toString()
  });
  const data = (await res.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.refresh_token) {
    // refresh_token 이 없으면(offline_access 미승인 등) 저장 불가 — 재동의 필요.
    throw new Error(
      `토큰 교환 실패: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}. (refresh_token 미수신 — offline_access 스코프 승인 여부를 확인하세요.)`
    );
  }
  const email = data.access_token ? await fetchProfileEmail(data.access_token).catch(() => undefined) : undefined;
  await saveToken(sessionDir, { refresh_token: data.refresh_token, email, provider: "outlook" });
  console.log(`✅ Outlook 로그인 완료 — refresh_token 을 로컬에 저장했습니다${email ? ` (${email})` : ""}.`);
}

// refresh_token → 단기 access_token(매 fetch/send 앞에서 갱신). access_token 은 저장하지 않는다.
async function getAccessToken(sessionDir: string): Promise<{ accessToken: string; email?: string }> {
  const stored = await loadToken(sessionDir);
  if (!stored?.refresh_token) {
    throw new Error("Outlook 세션이 없습니다. 먼저 마법사에서 Outlook 을 로그인(연결)하세요.");
  }
  const { clientId, clientSecret } = getOAuthCreds();
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: stored.refresh_token,
      scope: SCOPES.join(" "),
      grant_type: "refresh_token"
    }).toString()
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`access_token 갱신 실패: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}. 재로그인이 필요할 수 있습니다.`);
  }
  return { accessToken: data.access_token, email: stored.email };
}

async function fetchProfileEmail(accessToken: string): Promise<string | undefined> {
  const res = await fetch(`${GRAPH_API}/me?$select=mail,userPrincipalName`, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = (await res.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string };
  // mail 이 없는 계정(개인 MSA 일부)은 userPrincipalName 으로 폴백.
  return (data.mail ?? data.userPrincipalName)?.toLowerCase();
}

// ── Graph 파싱 헬퍼 ──
type GraphAddress = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id?: string;
  conversationId?: string;
  receivedDateTime?: string; // ISO datetime
  subject?: string;
  from?: GraphAddress;
  sender?: GraphAddress;
  body?: { contentType?: "text" | "html"; content?: string };
  bodyPreview?: string;
};

// Graph body 를 텍스트로. html 이면 태그 제거(email.ts extractText 의 html 정리 규칙과 동일).
function extractText(body: GraphMessage["body"], preview: string | undefined): string {
  const content = body?.content ?? "";
  if (body?.contentType === "html" && content) {
    return content
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
  return (content || preview || "").trim();
}

// GraphAddress → 소문자 이메일 주소. email.ts parseAddress 와 동형(정규화된 주소 반환).
function addr(a: GraphAddress | undefined): string {
  return (a?.emailAddress?.address ?? "").trim().toLowerCase();
}
// GraphAddress → 표시 이름(없으면 주소 앞부분). email.ts parseDisplayName 와 동형.
function displayName(a: GraphAddress | undefined): string {
  const name = a?.emailAddress?.name?.trim();
  if (name) return name;
  const email = addr(a);
  return email.split("@")[0] || email;
}

// ── fetch ──
export async function fetchEmail(sessionDir: string): Promise<ChatRawConversation[]> {
  const { accessToken, email: myEmail } = await getAccessToken(sessionDir);
  const auth = { authorization: `Bearer ${accessToken}` };

  // 최근 메일(필요한 필드만 $select). 최신순 정렬은 Graph 기본이 receivedDateTime desc 지만 명시.
  const select = "id,conversationId,receivedDateTime,subject,from,sender,body,bodyPreview";
  const url = `${GRAPH_API}/me/messages?$top=${FETCH_LIMIT}&$orderby=receivedDateTime desc&$select=${encodeURIComponent(select)}`;
  const listRes = await fetch(url, { headers: auth });
  const list = (await listRes.json().catch(() => ({}))) as { value?: GraphMessage[]; error?: unknown };
  if (!listRes.ok) {
    throw new Error(`Graph 메일 목록 조회 실패: HTTP ${listRes.status}`);
  }

  // conversationId 로 묶는다(=Gmail threadId 대응). 한 건 실패는 그 건만 건너뛴다.
  const byThread = new Map<string, { messages: ChatRawMessage[]; contactName: string; contactId: string }>();
  for (const msg of list.value ?? []) {
    try {
      const fromField = msg.from ?? msg.sender; // from 이 비면 sender 로 폴백.
      const fromAddr = addr(fromField);
      const direction: ChatRawMessage["direction"] = myEmail && fromAddr === myEmail ? "outbound" : "inbound";
      const text = extractText(msg.body, msg.bodyPreview);
      const subject = msg.subject ?? "";
      // email.ts 동일: 스레드 첫 표시에 제목이 보이게 텍스트 앞에 제목을 얹는다.
      const body = subject && text ? `${subject}\n\n${text}` : subject || text;
      if (!body) continue;

      const threadId = msg.conversationId ?? msg.id ?? "";
      if (!threadId) continue;
      const entry = byThread.get(threadId) ?? {
        messages: [],
        contactName: direction === "inbound" ? displayName(fromField) : "",
        contactId: direction === "inbound" ? fromAddr : ""
      };
      // 아직 상대 정보가 없고 이번이 inbound 면 채운다.
      if (!entry.contactId && direction === "inbound") {
        entry.contactName = displayName(fromField);
        entry.contactId = fromAddr;
      }
      entry.messages.push({
        id: msg.id ?? threadId,
        text: body,
        sentAt: new Date(msg.receivedDateTime ?? Date.now()).toISOString(),
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
// 답장을 같은 대화(conversationId)에 넣는다. recipient = 불러온 대화의 contactId(=상대 이메일 주소).
//   ★threadId(=conversationId)를 받으면 그 대화의 최신 메일에 Graph reply 로 회신 → Graph 가
//   In-Reply-To/References/스레드를 알아서 유지한다. 없으면 sendMail 로 새 메일을 상대에게 보낸다
//   (신규 스레드 — email.ts 의 '근사 폴백'과 달리 오배송 위험 대신 그냥 새 스레드가 된다).
export async function sendEmail(
  sessionDir: string,
  recipient: string,
  text: string,
  threadId?: string
): Promise<void> {
  const { accessToken } = await getAccessToken(sessionDir);
  const auth = { authorization: `Bearer ${accessToken}` };

  // 회신할 메일 하나 찾기: conversationId 로 그 대화의 최신 메일 id 를 얻는다.
  let replyToId: string | undefined;
  if (threadId) {
    const q = `${GRAPH_API}/me/messages?$filter=${encodeURIComponent(`conversationId eq '${threadId}'`)}&$top=1&$orderby=receivedDateTime desc&$select=id`;
    const res = await fetch(q, { headers: auth });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { value?: { id?: string }[] };
      replyToId = data.value?.[0]?.id;
    }
  }

  if (replyToId) {
    // 같은 스레드에 회신. comment = 본문. Graph 가 수신자/제목(Re:)/헤더를 원본에서 채워 스레드를 유지한다.
    const res = await fetch(`${GRAPH_API}/me/messages/${replyToId}/reply`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ comment: text })
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`이메일 회신 실패: HTTP ${res.status} ${err.slice(0, 200)}`);
    }
    console.log(`📤 Outlook 회신 완료 → ${recipient}`);
    return;
  }

  // 신규 메일: sendMail. 스레드가 없으니 제목은 비워둘 수 없어 최소 제목만.
  const res = await fetch(`${GRAPH_API}/me/sendMail`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: "(no subject)",
        body: { contentType: "text", content: text },
        toRecipients: [{ emailAddress: { address: recipient } }]
      }
    })
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`이메일 발송 실패: HTTP ${res.status} ${err.slice(0, 200)}`);
  }
  console.log(`📤 Outlook 발송 완료 → ${recipient}`);
}
