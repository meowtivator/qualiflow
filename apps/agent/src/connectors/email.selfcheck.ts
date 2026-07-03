// 이메일 커넥터 자가 점검 — 프레임워크 없이 node:assert. 네트워크/구글 없이 fetch 를 스텁해
// fetchEmail 의 정규화(스레드 묶기 · direction 판정 · base64url 본문 디코드)를 검증한다.
//   실행: pnpm --filter @qualiflow/agent exec tsx src/connectors/email.selfcheck.ts
// 로직이 깨지면 assert 가 던진다(깨진 채로 "통과"하지 않게).

import assert from "node:assert/strict";

import { fetchEmail } from "./email";

process.env.GMAIL_CLIENT_ID = "test-id";
process.env.GMAIL_CLIENT_SECRET = "test-secret";

const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const ME = "me@shop.com";
const BUYER = "buyer@acme.com";

// Gmail 응답 4종을 URL 로 분기해 돌려주는 fetch 스텁.
const messages: Record<string, unknown> = {
  m1: { id: "m1", threadId: "t1", internalDate: "1700000000000", payload: { headers: [{ name: "From", value: "Acme Buyer <buyer@acme.com>" }, { name: "Subject", value: "가격 문의" }], mimeType: "text/plain", body: { data: b64url("샘플 100개 견적 주세요") } } },
  m2: { id: "m2", threadId: "t1", internalDate: "1700000100000", payload: { headers: [{ name: "From", value: ME }, { name: "Subject", value: "Re: 가격 문의" }], mimeType: "text/plain", body: { data: b64url("네, 첨부드립니다") } } }
};

globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Promise<Response>;
  if (url.includes("/oauth2") || url.includes("oauth2.googleapis.com")) return json({ access_token: "at" });
  if (url.endsWith("/profile")) return json({ emailAddress: ME });
  if (url.includes("/messages/m")) return json(messages[url.split("/messages/")[1].split("?")[0]]);
  if (url.includes("/messages")) return json({ messages: [{ id: "m1" }, { id: "m2" }] });
  return json({});
}) as typeof fetch;

// getAccessToken 은 token.json(refresh_token)을 읽는다 → 임시 세션 디렉터리에 심어 둔다.
const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const dir = await mkdtemp(join(tmpdir(), "qf-email-"));
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "token.json"), JSON.stringify({ refresh_token: "rt", email: ME }));

const convos = await fetchEmail(dir);

assert.equal(convos.length, 1, "같은 threadId 두 메일은 한 스레드로 묶여야 한다");
const c = convos[0];
assert.equal(c.threadId, "t1");
assert.equal(c.contact.id, BUYER, "연락처=inbound 발신자(구매자)여야 한다");
assert.equal(c.contact.name, "Acme Buyer", "표시 이름이 From 에서 파싱돼야 한다");
assert.equal(c.messages.length, 2);
assert.equal(c.messages[0].direction, "inbound", "구매자 메일 = inbound");
assert.equal(c.messages[1].direction, "outbound", "내(me@shop.com) 메일 = outbound");
assert.ok(c.messages[0].text.includes("샘플 100개"), "base64url 본문이 디코드돼야 한다");
assert.ok(c.messages[0].text.startsWith("가격 문의"), "제목이 본문 앞에 붙어야 한다");
assert.ok(c.messages[0].sentAt < c.messages[1].sentAt, "메시지는 시간순 정렬돼야 한다");

console.log("✅ email.selfcheck 통과 —", convos.length, "스레드,", c.messages.length, "메시지");
