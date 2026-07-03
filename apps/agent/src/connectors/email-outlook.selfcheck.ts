// Outlook 커넥터 자가 점검 — 프레임워크 없이 node:assert. 네트워크/MS 없이 fetch 를 스텁해
// fetchEmail 의 정규화(conversationId 로 스레드 묶기 · direction 판정 · html 본문 태그 제거)를 검증한다.
//   실행: pnpm --filter @qualiflow/agent exec tsx src/connectors/email-outlook.selfcheck.ts
// 로직이 깨지면 assert 가 던진다(깨진 채로 "통과"하지 않게).

import assert from "node:assert/strict";

import { fetchEmail } from "./email-outlook";

process.env.MS_CLIENT_ID = "test-id";
process.env.MS_CLIENT_SECRET = "test-secret";

const ME = "me@shop.com";
const BUYER = "buyer@acme.com";

// Graph 메시지 2건: 같은 conversationId(c1), inbound(구매자) + outbound(나). 본문은 html 로 줘서 태그 제거를 검증.
const value = [
  {
    id: "m1",
    conversationId: "c1",
    receivedDateTime: "2023-11-14T00:00:00Z",
    subject: "가격 문의",
    from: { emailAddress: { name: "Acme Buyer", address: BUYER } },
    body: { contentType: "html", content: "<p>샘플 100개 견적 주세요</p>" }
  },
  {
    id: "m2",
    conversationId: "c1",
    receivedDateTime: "2023-11-14T00:01:40Z",
    subject: "Re: 가격 문의",
    from: { emailAddress: { name: "Me Shop", address: ME } },
    body: { contentType: "text", content: "네, 첨부드립니다" }
  }
];

globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Promise<Response>;
  if (url.includes("oauth2.v2.0/token") || url.includes("/oauth2/v2.0/token")) return json({ access_token: "at" });
  if (url.includes("/me?")) return json({ mail: ME }); // fetchProfileEmail
  if (url.includes("/me/messages")) return json({ value });
  return json({});
}) as typeof fetch;

// getAccessToken 은 token.json(refresh_token)을 읽는다 → 임시 세션 디렉터리에 심어 둔다.
const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const dir = await mkdtemp(join(tmpdir(), "qf-outlook-"));
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "token.json"), JSON.stringify({ refresh_token: "rt", email: ME, provider: "outlook" }));

const convos = await fetchEmail(dir);

assert.equal(convos.length, 1, "같은 conversationId 두 메일은 한 스레드로 묶여야 한다");
const c = convos[0];
assert.equal(c.threadId, "c1");
assert.equal(c.contact.id, BUYER, "연락처=inbound 발신자(구매자)여야 한다");
assert.equal(c.contact.name, "Acme Buyer", "표시 이름이 from 에서 파싱돼야 한다");
assert.equal(c.messages.length, 2);
assert.equal(c.messages[0].direction, "inbound", "구매자 메일 = inbound");
assert.equal(c.messages[1].direction, "outbound", "내(me@shop.com) 메일 = outbound");
assert.ok(c.messages[0].text.includes("샘플 100개"), "html 본문이 태그 제거돼 텍스트로 나와야 한다");
assert.ok(!c.messages[0].text.includes("<p>"), "html 태그가 제거돼야 한다");
assert.ok(c.messages[0].text.startsWith("가격 문의"), "제목이 본문 앞에 붙어야 한다");
assert.ok(c.messages[0].sentAt < c.messages[1].sentAt, "메시지는 시간순 정렬돼야 한다");

console.log("✅ email-outlook.selfcheck 통과 —", convos.length, "스레드,", c.messages.length, "메시지");
