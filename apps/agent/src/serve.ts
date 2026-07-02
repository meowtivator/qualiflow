// 명령 채널 상주(serve): 서버를 롱폴해 명령을 받아 실행하고 결과를 보고한다.
// 현재 명령: send_message — 웹에서 답장을 적재하면 여기서 기존 sendMessage로 채널에 보낸다.
// 보안/전송: authedFetch(Bearer 토큰)로만 서버와 통신. 채널 세션/발송은 전부 이 PC 로컬.

import { authedFetch, NotPairedError } from "./api-client";
import { fetchAllAccounts, sendMessage } from "./fetch";
import { pushAllAccounts } from "./push";

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
  // 결과 보고는 재시도한다 — 일시적 네트워크 실패로 명령이 'claimed'에 영원히 묶이는 걸(좀비) 줄인다.
  // (재claim은 안 하므로 보고가 끝내 실패하면 중복발송 대신 '미보고'로 남는다 = 안전한 쪽.)
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await authedFetch("/api/agents/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId, status, result })
      });
      if (response.ok) {
        return;
      }
    } catch {
      // 다음 시도
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  console.error(`  ⚠️ 결과 보고 실패(${commandId.slice(0, 8)}) — 명령이 'claimed'로 남을 수 있습니다(중복발송은 안 됨).`);
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

// ────────────────────────────────────────────────────────────────────────
// watch — 실시간(주기) fetch 상주 모드.
//   한 사이클 = 등록된 모든 계정을 라이브로 fetch → 그 결과를 클라우드로 push(인박스 최신화).
//   fetch만 하고 끝나지 않고 push까지 해서 웹 인박스가 따라온다(과거 daemon 명령을 흡수).
//   ★멱등: push는 external_message_id 기준 멱등이라(같은 메시지 재전송 안전) 매 사이클 중복 ingest 무해.
//   ★재시도/백오프: 한 사이클이 실패해도 죽지 않고, 연속 실패 시 대기를 지수적으로 늘려(상한 있음)
//     서버/채널을 두드리지 않는다. 성공하면 백오프는 기본 간격으로 리셋.
//   ★세션 유지: 매 사이클 같은 계정 프로필(.auth/...)을 재사용 → 로그인 세션이 살아 있으면 재로그인 없음.
// 환경변수:
//   QUALIFLOW_WATCH_INTERVAL_MS  성공 사이클 사이 간격(기본 QUALIFLOW_SYNC_INTERVAL_MS, 없으면 5분).
//   QUALIFLOW_WATCH_MAX_BACKOFF_MS  연속 실패 시 대기 상한(기본 30분).
// ────────────────────────────────────────────────────────────────────────
function watchIntervalMs(): number {
  const explicit = Number(process.env.QUALIFLOW_WATCH_INTERVAL_MS);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const shared = Number(process.env.QUALIFLOW_SYNC_INTERVAL_MS);
  if (Number.isFinite(shared) && shared > 0) {
    return shared;
  }
  return 5 * 60_000; // 기본 5분 — 촘촘한 "실시간" 기본값.
}

function watchMaxBackoffMs(): number {
  const value = Number(process.env.QUALIFLOW_WATCH_MAX_BACKOFF_MS);
  return Number.isFinite(value) && value > 0 ? value : 30 * 60_000; // 기본 30분 상한.
}

// 한 사이클: 라이브 fetch → push. push는 미페어링이면 건너뛴다(로컬 fetch만으로도 의미 있음).
// 사이클 자체 실패(예: fetch 전부 throw)는 호출자가 잡아 백오프하도록 다시 던진다.
async function watchCycle(): Promise<void> {
  const summaries = await fetchAllAccounts({ cached: false });
  console.log("── fetch 요약 ──");
  for (const summary of summaries) {
    console.log(`   ${summary.channel}/${summary.label}: 대화 ${summary.conversationCount} · 메시지 ${summary.messageCount}`);
  }

  // push: 페어링됐을 때만 클라우드로 올린다. 미페어링이면 조용히 건너뛴다(watch는 계속 fetch).
  try {
    const results = await pushAllAccounts();
    if (results.length) {
      console.log("── push 요약 ──");
      for (const result of results) {
        const icon = result.status === "pushed" ? "✅" : result.status === "skipped" ? "⏭️ " : "❌";
        console.log(`   ${icon} ${result.channel}/${result.label} — ${result.detail}`);
      }
    }
  } catch (error) {
    if (error instanceof NotPairedError) {
      console.log("   ⏭️  미페어링 — 클라우드 push는 건너뜁니다(로컬 fetch만 수행). 'pair <코드>'로 연결하면 자동 동기화됩니다.");
    } else {
      // ★push 실패는 백오프시키지 않는다 — fetch는 이미 .data에 저장돼 유실 없고, push만 다음 사이클에
      //   재시도한다. 예전엔 throw해서 push 장애가 fetch 주기(최대 30분)까지 끌어내렸다(실시간성 저하). 분리.
      console.error(`   ❌ push 실패(다음 사이클에 재시도): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function watch(): Promise<void> {
  const baseIntervalMs = watchIntervalMs();
  const maxBackoffMs = watchMaxBackoffMs();
  console.log(
    `🛰  실시간 fetch 상주(watch) 시작 — ${Math.round(baseIntervalMs / 60_000)}분 간격, 실패 시 최대 ${Math.round(
      maxBackoffMs / 60_000
    )}분까지 백오프. (Ctrl-C 종료)`
  );

  let consecutiveFailures = 0;
  for (;;) {
    const startedAt = new Date().toISOString();
    console.log(`\n[${startedAt}] 사이클 시작...`);
    let waitMs = baseIntervalMs;
    try {
      await watchCycle();
      consecutiveFailures = 0; // 성공 → 백오프 리셋, 기본 간격으로 대기.
    } catch (error) {
      // 한 사이클이 통째로 실패해도 루프는 죽지 않는다. 연속 실패할수록 대기를 지수적으로 늘린다(상한).
      consecutiveFailures += 1;
      const backoff = Math.min(baseIntervalMs * 2 ** consecutiveFailures, maxBackoffMs);
      // 지터(±20%): 여러 에이전트가 동시에 깨어나 서버를 동시에 두드리는 걸 분산한다.
      waitMs = Math.round(backoff * (0.8 + Math.random() * 0.4));
      console.error(
        `사이클 실패(${consecutiveFailures}회 연속): ${error instanceof Error ? error.message : String(error)} — ${Math.round(
          waitMs / 1000
        )}초 후 재시도.`
      );
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, waitMs));
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
