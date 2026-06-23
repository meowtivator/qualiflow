#!/usr/bin/env node

// QualiFlow 로컬 에이전트 — 코어 CLI(설치형 GUI는 이후 단계에서 이 코어를 감싼다).
//   accounts                            등록된 계정 목록
//   add <channel> <label>               계정 추가(로그인/QR) — 계정별 세션
//   remove <channel> <label>            계정 삭제(세션·데이터 포함)
//   fetch <channel> [label] [--cached]  그 계정 인박스 → 정규화 요약
//   pair <코드> | status                (보안 레이어 — 나중)

import { addAccount, listAccounts, removeAccount, resolveLabel, sanitizeLabel, sessionPath } from "./accounts";
import { loginInstagram } from "./connectors/instagram";
import { loginTelegram } from "./connectors/telegram";
import { loadLocalEnv } from "./env";
import { fetchAllAccounts, fetchChannel, fetchWhatsAppInbox, listChannelThreads, loginAlibaba, sendMessage } from "./fetch";
import { pair } from "./pair";
import { loadToken } from "./token-store";

async function main() {
  loadLocalEnv(); // apps/web/.env.local 의 TELEGRAM_* 등을 읽어 process.env에 넣는다.
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "accounts": {
      const accounts = await listAccounts();
      if (!accounts.length) {
        console.log("등록된 계정이 없습니다. 'add <channel> <label>'로 추가하세요.");
        return;
      }
      console.log("등록된 계정:");
      for (const account of accounts) {
        console.log(`  - ${account.channel} / ${account.label}  (추가 ${account.addedAt.slice(0, 10)})`);
      }
      return;
    }

    case "add": {
      const channel = args[1];
      const label = args[2];
      if (!channel || !label) {
        console.error("사용법: add <channel: alibaba|whatsapp|telegram|instagram> <label>");
        process.exitCode = 1;
        return;
      }
      const account = await addAccount(channel, label);
      console.log(`✅ 계정 등록: ${account.channel} / ${account.label}`);
      if (channel === "alibaba") {
        console.log("이 계정 전용 프로필로 로그인 창을 엽니다...");
        await loginAlibaba(sessionPath("alibaba", account.label));
      } else if (channel === "whatsapp") {
        console.log("이 계정 전용으로 WhatsApp QR을 띄웁니다...");
        await fetchWhatsAppInbox(account.label);
      } else if (channel === "telegram") {
        console.log("Telegram 전화 코드 로그인을 시작합니다(전화번호 → 받은 코드 입력)...");
        await loginTelegram(sessionPath("telegram", account.label));
      } else if (channel === "instagram") {
        console.log("Instagram 로그인 창을 엽니다(브라우저에서 직접 로그인)...");
        await loginInstagram(sessionPath("instagram", account.label));
      } else {
        console.log(`'${channel}' 커넥터는 다음 단계입니다 — 등록만 완료(로그인은 추후).`);
      }
      return;
    }

    case "remove": {
      const channel = args[1];
      const label = args[2];
      if (!channel || !label) {
        console.error("사용법: remove <channel> <label>");
        process.exitCode = 1;
        return;
      }
      await removeAccount(channel, label);
      console.log(`🗑  계정 삭제(세션·데이터 포함): ${channel} / ${sanitizeLabel(label)}`);
      return;
    }

    case "fetch": {
      const cached = args.includes("--cached");

      // fetch all — 등록된 모든 계정을 한 번에 긁고 합산 요약(한꺼번에 확인).
      if (args[1] === "all") {
        const summaries = await fetchAllAccounts({ cached });
        console.log("\n══════ 전체 요약 ══════");
        let totalConversations = 0;
        let totalMessages = 0;
        for (const summary of summaries) {
          console.log(
            `  ${summary.channel}/${summary.label}: 대화 ${summary.conversationCount} · 메시지 ${summary.messageCount}`
          );
          totalConversations += summary.conversationCount;
          totalMessages += summary.messageCount;
        }
        console.log(`  ─ 합계: 계정 ${summaries.length} · 대화 ${totalConversations} · 메시지 ${totalMessages}`);
        return;
      }

      // fetch <channel> [label] [--cached]. label 생략 시 그 채널 계정이 1개면 그것, 여러 개면 라벨 요구.
      const channel = args[1] && !args[1].startsWith("--") ? args[1] : "alibaba";
      const rawLabel = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
      const label = await resolveLabel(channel, rawLabel);
      const summary = await fetchChannel(channel, label, { cached });
      console.log(`✅ ${summary.channel}/${summary.label} 인박스 → 정규화 완료`);
      console.log(
        `   대화 ${summary.conversationCount} · 리드 ${summary.leadCount} · 스레드 ${summary.threadCount} · 메시지 ${summary.messageCount}`
      );
      for (const item of summary.sample) {
        console.log(`   - ${item.lead}: "${item.lastText}"`);
      }
      return;
    }

    case "threads": {
      const channel = args[1];
      if (!channel) {
        console.error("사용법: threads <channel> [label]  — 불러온 대화의 threadId(발송 대상) 목록");
        process.exitCode = 1;
        return;
      }
      const label = await resolveLabel(channel, args[2]);
      const threads = await listChannelThreads(channel, label);
      if (!threads.length) {
        console.log(`${channel}/${label}: 불러온 대화가 없습니다(먼저 'fetch ${channel} ${label}').`);
        return;
      }
      console.log(`${channel}/${label} 대화 (threadId — 이름):`);
      for (const thread of threads) {
        console.log(`  ${thread.id}  —  ${thread.name}`);
      }
      return;
    }

    case "send": {
      const channel = args[1];
      const label = args[2];
      const recipient = args[3];
      const text = args.slice(4).join(" ");
      if (!channel || !label || !recipient || !text) {
        console.error("사용법: send <channel> <label> <recipient> <text>");
        console.error("  recipient: me(나에게 — 텔레/왓츠앱) 또는 불러온 대화의 threadId(실제 채팅방)");
        console.error('  예: send telegram main me "테스트 메시지"');
        process.exitCode = 1;
        return;
      }
      await sendMessage(channel, label, recipient, text);
      console.log(`✅ ${channel}/${label} → ${recipient} 발송 요청 완료`);
      return;
    }

    case "pair": {
      const code = args[1];
      if (!code) {
        console.error("사용법: pair <코드>");
        process.exitCode = 1;
        return;
      }
      const { agentId, workspaceId } = await pair(code);
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

    default:
      console.log(
        [
          "QualiFlow agent — 명령:",
          "  accounts                            등록된 계정 목록",
          "  add <channel> <label>               계정 추가(로그인/QR)",
          "  remove <channel> <label>            계정 삭제(세션·데이터)",
          "  fetch <channel> [label] [--cached]  인박스 긁기 → 정규화",
          "  fetch all [--cached]                등록된 모든 계정 한 번에 → 합산 요약",
          "  threads <channel> [label]           불러온 대화의 threadId 목록(발송 대상 고르기)",
          "  send <channel> <label> <받는이> <텍스트>   메시지 발송(받는이=me 또는 threadId)",
          "  pair <코드> | status                (보안 레이어 — 나중)"
        ].join("\n")
      );
  }
}

main().catch((error) => {
  console.error(`에러: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
