#!/usr/bin/env node

// 리드 등급 스코어링 평가 스크립트 (논문 "실험" 섹션 생성기 + 스코어링 QA 도구).
// 정답지(eval-set.json)의 각 메시지를 스코어링에 넣고, 사람이 매긴 정답과 비교해
// 정확도·혼동행렬·등급별 재현율을 출력한다.
//   실행: pnpm --filter @qualiflow/web run qualify:eval
//
// ※ 여기서는 규칙기반 스코어링(C1)만 측정한다. 클라우드/로컬 LLM(C2/C3)을 같은
//    정답지로 돌려 같은 표에 채우면 "스코어링 vs LLM" 비교 실험이 된다.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Lead, LeadGrade, Message } from "@qualiflow/core";

import { scoreLead } from "./score.js";

type EvalItem = { id: number; message: string; company?: string; country?: string; label: LeadGrade };

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(resolve(here, "__fixtures__/eval-set.json"), "utf8")) as {
  items: EvalItem[];
};

const GRADES: LeadGrade[] = ["A", "B", "C"];

function predict(item: EvalItem): LeadGrade {
  const lead = {
    id: `eval_${item.id}`,
    displayName: item.company ?? "buyer",
    companyName: item.company,
    countryName: item.country
  } as unknown as Lead;
  const message = { direction: "inbound", content: { type: "text", text: item.message } } as unknown as Message;
  return scoreLead(lead, [message]).grade;
}

// 혼동행렬: confusion[정답][예측] = 건수
const confusion: Record<LeadGrade, Record<LeadGrade, number>> = {
  A: { A: 0, B: 0, C: 0 },
  B: { A: 0, B: 0, C: 0 },
  C: { A: 0, B: 0, C: 0 }
};

let correct = 0;
console.log("리드 등급 스코어링 평가 (C1: 규칙기반)\n");
console.log("id  | 정답 | 예측 | 결과 | 메시지");
console.log("----+------+------+------+--------------------------------------------");
for (const item of fixture.items) {
  const pred = predict(item);
  confusion[item.label][pred] += 1;
  const ok = pred === item.label;
  if (ok) correct += 1;
  const idStr = String(item.id).padStart(2, " ");
  console.log(`${idStr}  |  ${item.label}   |  ${pred}   |  ${ok ? "O" : "X"}   | ${item.message.slice(0, 44)}`);
}

const total = fixture.items.length;
const accuracy = ((correct / total) * 100).toFixed(1);

console.log("\n── 혼동행렬 (행=정답, 열=예측) ──");
console.log("        예측A  예측B  예측C");
for (const g of GRADES) {
  const row = GRADES.map((p) => String(confusion[g][p]).padStart(5, " ")).join(" ");
  console.log(`정답${g}  ${row}`);
}

console.log("\n── 등급별 재현율 (정답 중 맞춘 비율) ──");
for (const g of GRADES) {
  const totalG = GRADES.reduce((sum, p) => sum + confusion[g][p], 0);
  const recall = totalG ? ((confusion[g][g] / totalG) * 100).toFixed(0) : "-";
  console.log(`${g}: ${confusion[g][g]}/${totalG} = ${recall}%`);
}

console.log(`\n전체 정확도: ${correct}/${total} = ${accuracy}%`);
console.log("\n표 양식(논문 표2):  C1 규칙기반 정확도 = " + accuracy + "%  | C2 클라우드LLM = 「측정」 | C3 로컬LLM = 「측정」");
