#!/usr/bin/env node

// QualiFlow 로컬 에이전트 — 코어 CLI(설치형 GUI는 이후 단계에서 이 코어를 감싼다).
//   pair <코드>  웹에서 발급한 페어링 코드로 연결(토큰을 키체인에 저장)
//   status       연결 상태(키체인에 토큰이 있는지)
//   read         채널 읽기(샘플 fixture) → 기존 어댑터로 정규화 → 요약 출력

import { fetchAlibaba } from "./fetch";
import { pair } from "./pair";
import { readSampleInbox } from "./read";
import { loadToken } from "./token-store";

async function main() {
  const [command, arg] = process.argv.slice(2);

  switch (command) {
    case "pair": {
      if (!arg) {
        console.error("사용법: pnpm --filter @qualiflow/agent pair <코드>");
        process.exitCode = 1;
        return;
      }
      const { agentId, workspaceId } = await pair(arg);
      console.log("✅ 페어링 완료 — 에이전트 토큰을 OS 키체인에 저장했습니다.");
      console.log(`   agentId=${agentId}`);
      console.log(`   workspaceId=${workspaceId}`);
      return;
    }

    case "status": {
      const token = await loadToken();
      console.log(
        token
          ? "✅ 연결됨 — 에이전트 토큰이 키체인에 있습니다."
          : "⚠️ 미연결 — 먼저 'pair <코드>'로 페어링하세요."
      );
      return;
    }

    case "fetch": {
      // 실제 알리바바 커넥터 실행(라이브). --cached 면 이미 추출된 데이터만 읽어 정규화.
      const cached = process.argv.includes("--cached");
      const summary = await fetchAlibaba({ cached });
      console.log("✅ 알리바바 인박스 → 정규화 완료");
      console.log(
        `   대화 ${summary.conversationCount} · 리드 ${summary.leadCount} · 스레드 ${summary.threadCount} · 메시지 ${summary.messageCount}`
      );
      for (const item of summary.sample) {
        console.log(`   - ${item.lead}: "${item.lastText}"`);
      }
      return;
    }

    case "read": {
      const summary = await readSampleInbox();
      console.log("📥 채널 읽기(샘플 fixture) → 정규화 완료");
      console.log(`   리드 ${summary.leadCount} · 스레드 ${summary.threadCount} · 메시지 ${summary.messageCount}`);
      for (const item of summary.sample) {
        console.log(`   - [${item.thread}] ${item.lead}: "${item.lastText}" (${item.direction})`);
      }
      return;
    }

    default:
      console.log("QualiFlow agent — 명령: fetch [--cached] | pair <코드> | status | read");
  }
}

main().catch((error) => {
  console.error(`에러: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
