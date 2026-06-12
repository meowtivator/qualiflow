#!/usr/bin/env node

// 마이그레이션 SQL의 CHECK 값 목록이 core의 단일출처 배열과 일치하는지 검사한다.
// "마이그레이션 ↔ 데이터(core 타입)" 짝이 어긋나면 여기서 빨간불 → 런타임 깨짐을 미리 막는다.
//   실행: pnpm run schema:check  (verify에 포함됨)

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CHANNEL_CONNECTION_STATUSES, FOLLOW_UP_STATES, LEAD_STAGES, LEAD_SUB_STAGES } from "@qualiflow/core";

const migrationsDir = resolve(process.cwd(), "supabase/migrations");
const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
const sql = (await Promise.all(files.map((name) => readFile(resolve(migrationsDir, name), "utf8"))))
  .join("\n")
  .replace(/--[^\n]*/g, ""); // SQL 라인 주석 제거(IN 목록 안 주석이 값으로 잡히는 것 방지)

// "<column> ... check (<column> in ('a','b',...))" 에서 값 목록 추출 (마지막 정의 우선)
function extractCheckValues(column: string): string[] | null {
  const re = new RegExp(`${column}[^;]*?check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, "gis");
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = re.exec(sql)) !== null) {
    last = match[1];
  }
  if (last === null) {
    return null;
  }
  return last
    .split(",")
    .map((token) => token.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

let failed = false;

function check(label: string, column: string, expected: readonly string[]) {
  const got = extractCheckValues(column);
  const exp = [...expected].sort();
  const actual = got ? [...got].sort() : null;
  const ok = actual !== null && JSON.stringify(actual) === JSON.stringify(exp);
  if (ok) {
    console.log(`  ✅ ${label}: SQL CHECK == core 상수 (${exp.join(", ")})`);
  } else {
    console.error(`  ❌ ${label}: 불일치`);
    console.error(`     core: ${exp.join(", ")}`);
    console.error(`     SQL : ${actual ? actual.join(", ") : "(CHECK 못 찾음)"}`);
    failed = true;
  }
}

console.log("schema-contract — 마이그레이션 CHECK ↔ core 상수 일치 검사\n");
check("leads.stage", "stage", LEAD_STAGES);
check("leads.sub_stage", "sub_stage", LEAD_SUB_STAGES);
check("threads.follow_up", "follow_up", FOLLOW_UP_STATES);
check("channel_connections.status", "status", CHANNEL_CONNECTION_STATUSES);

if (failed) {
  console.error("\n❌ 불일치 — 마이그레이션과 core 상수를 맞추세요.");
  process.exit(1);
}
console.log("\n✅ 마이그레이션과 core가 일치합니다.");
