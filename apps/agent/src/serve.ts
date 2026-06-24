// 명령 채널 상주(serve): 서버를 롱폴해 명령을 받아 실행하고 결과를 보고한다.
// 현재 명령: send_message — 웹에서 답장을 적재하면 여기서 기존 sendMessage로 채널에 보낸다.
// 보안/전송: authedFetch(Bearer 토큰)로만 서버와 통신. 채널 세션/발송은 전부 이 PC 로컬.

import { authedFetch, NotPairedError } from "./api-client";
import { sendMessage } from "./fetch";

type AgentCommand = {
  id: string;
  type: string;
  payload: {
    channel?: string;
    accountLabel?: string;
    recipient?: string;
    text?: string;
  };
};

async function claimCommands(): Promise<AgentCommand[]> {
  const response = await authedFetch("/api/agents/commands"); // 롱폴 GET
  if (!response.ok) {
    throw new Error(`명령 조회 실패: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { ok?: boolean; commands?: AgentCommand[] };
  return Array.isArray(data.commands) ? data.commands : [];
}

async function reportResult(commandId: string, status: "done" | "failed", result: Record<string, unknown>): Promise<void> {
  await authedFetch("/api/agents/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commandId, status, result })
  });
}

async function executeCommand(command: AgentCommand): Promise<void> {
  if (command.type !== "send_message") {
    await reportResult(command.id, "failed", { error: `알 수 없는 명령 타입: ${command.type}` });
    return;
  }
  const { channel, accountLabel, recipient, text } = command.payload;
  if (!channel || !accountLabel || !recipient || !text) {
    await reportResult(command.id, "failed", { error: "payload가 불완전합니다." });
    return;
  }
  try {
    await sendMessage(channel, accountLabel, recipient, text);
    await reportResult(command.id, "done", { sent: true });
    console.log(`  ✅ 발송 완료 (${channel}/${accountLabel} → ${recipient})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reportResult(command.id, "failed", { error: message });
    console.log(`  ❌ 발송 실패: ${message}`);
  }
}

// 명령 채널 상주 루프. Ctrl-C 까지 무한. 에러 시 잠깐 쉬고 재시도(롱폴 타임아웃은 정상).
export async function serve(): Promise<void> {
  console.log("🛰  명령 채널 대기 중(롱폴). 웹에서 답장을 보내면 여기서 처리합니다. (Ctrl-C 종료)");
  for (;;) {
    try {
      const commands = await claimCommands();
      for (const command of commands) {
        console.log(`▶ 명령 ${command.type} (${command.id.slice(0, 8)}) 실행...`);
        await executeCommand(command);
      }
    } catch (error) {
      if (error instanceof NotPairedError) {
        console.error("미연결 — 먼저 'pair <코드>'로 페어링하세요.");
        return;
      }
      console.error("명령 폴 실패:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
