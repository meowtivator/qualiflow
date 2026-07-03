// 전화번호 포맷 자체 검사 — @lid 실명화의 "번호 폴백" 경로가 깨지면 여기서 실패한다.
// 실행: pnpm --filter @qualiflow/agent exec tsx --test src/connectors/whatsapp.format.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatPhone } from "./whatsapp";

test("유효한 국제번호 → 국기 포함 국제표기", () => {
  const out = formatPhone("821058745767");
  assert.match(out, /^\+82 /); // 국제표기(국가코드 +82)
  assert.ok(out.includes("🇰🇷")); // 국기 이모지 포함
});

test("파싱 불가한 숫자 → 최소 '+숫자' 폴백(빈 문자열 아님)", () => {
  // libphonenumber 가 못 푸는 숫자열이어도 사용자에게 lid 숫자 대신 +숫자는 보여준다.
  const out = formatPhone("000000");
  assert.equal(out, "+000000");
});
