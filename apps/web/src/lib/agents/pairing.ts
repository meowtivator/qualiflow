// 에이전트 페어링 crypto — 서버 전용. node:crypto + pepper(서버 시크릿)를 쓰므로 클라이언트로 import 금지.
//
// 핵심 불변식: 평문 코드/토큰은 만들어서 호출자에게 1회 돌려줄 뿐, DB로는 HMAC 해시만 보낸다.
//   pepper는 이 모듈(서버 env)에만 있고 DB엔 없다 → DB가 통째로 새도 코드/토큰은 역산 불가.

import { createHmac, randomBytes, randomInt } from "node:crypto";

// Crockford base32에서 헷갈리는 글자(I, L, O, U)를 뺀 32글자. 사람이 보고/입력하기 쉽게.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function getPepper(): string {
  const pepper = process.env.QUALIFLOW_PAIRING_PEPPER;
  if (!pepper) {
    // 라우트에서 먼저 isPairingConfigured()로 거르므로 정상 흐름에선 안 던진다(방어용).
    throw new Error("QUALIFLOW_PAIRING_PEPPER is not set");
  }
  return pepper;
}

export function isPairingConfigured(): boolean {
  return Boolean(process.env.QUALIFLOW_PAIRING_PEPPER);
}

// 사람이 입력하는 페어링 코드: XXXX-XXXX (8글자, 약 40bit).
export function generatePairingCode(): string {
  const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

// 입력 정규화(발급·검증 양쪽에서 동일 적용해야 해시가 일치): 대문자 + 구분자 제거 + 헷갈리는 글자 보정.
export function normalizePairingCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");
}

// 에이전트 토큰: 256bit 랜덤(불투명). 평문은 /pair 응답으로 1회만 나가고, DB엔 해시만.
export function generateAgentToken(): string {
  return randomBytes(32).toString("base64url");
}

// HMAC-SHA256(value, pepper) → hex. 서버에서만 계산. DB엔 이 결과(해시)만 저장.
export function hmacHash(value: string): string {
  return createHmac("sha256", getPepper()).update(value).digest("hex");
}
