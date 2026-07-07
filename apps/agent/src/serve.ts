// 명령 채널 상주(serve): 서버를 롱폴해 명령을 받아 실행하고 결과를 보고한다.
// 현재 명령: send_message — 웹에서 답장을 적재하면 여기서 기존 sendMessage로 채널에 보낸다.
// 보안/전송: authedFetch(Bearer 토큰)로만 서버와 통신. 채널 세션/발송은 전부 이 PC 로컬.

import { hasSession, listAccounts, removeAccount } from "./accounts";
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
    threadId?: string; // 이메일 회신을 원본 스레드에 붙일 때(bpd send 라우트가 실어 보내면 사용, 없으면 근사 폴백)
  };
};

async function claimCommands(): Promise<AgentCommand[]> {
  // 롱폴 GET — 서버가 최대 ~20초 잡고 응답(Cloudflare ~30초 컷 전에 먼저 응답하도록 서버 deadline 조정).
  //   35초 상한은 안전망: 정상이면 서버가 20초쯤 응답하고, 연결이 끊기면 abort → 호출부가 조용히 재연결.
  const response = await authedFetch("/api/agents/commands", {}, 35_000); // 롱폴 GET
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
  if (command.type === "remove_account") {
    return executeRemoveAccount(command);
  }
  if (command.type !== "send_message") {
    await reportResult(command.id, "failed", { error: `알 수 없는 명령 타입: ${command.type}` });
    return;
  }
  const { channel, accountLabel, recipient, text, threadId } = command.payload;
  if (!channel || !accountLabel || !recipient || !text) {
    await reportResult(command.id, "failed", { error: "payload가 불완전합니다." });
    return;
  }
  try {
    await sendMessage(channel, accountLabel, recipient, text, threadId);
    await reportResult(command.id, "done", { sent: true });
    console.log(`  ✅ 발송 완료 (${channel}/${accountLabel} → ${recipient})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reportResult(command.id, "failed", { error: message });
    console.log(`  ❌ 발송 실패: ${message}`);
  }
}

// remove_account — 웹의 '연결 계정 삭제'가 적재한 명령. 이 PC 로컬의 세션·데이터를 지운다(되돌리기 없음).
//   removeAccount 가 등록부에서 빼고 .auth/.data 를 rm 한다. 등록되지 않은 계정이면 실패로 보고.
async function executeRemoveAccount(command: AgentCommand): Promise<void> {
  const { channel, accountLabel } = command.payload;
  if (!channel || !accountLabel) {
    await reportResult(command.id, "failed", { error: "payload가 불완전합니다(channel, accountLabel 필요)." });
    return;
  }
  try {
    await removeAccount(channel, accountLabel);
    await reportResult(command.id, "done", { removed: true });
    console.log(`  ✅ 계정 삭제 완료 (${channel}/${accountLabel}) — 로컬 세션·데이터 제거`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reportResult(command.id, "failed", { error: message });
    console.log(`  ❌ 계정 삭제 실패: ${message}`);
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
  // ── 게이트 진단(관측만; fetch 로직은 안 바꾼다) ──────────────────────────────
  // "CRM에 안 뜬다"가 어느 문에서 막혔는지 로그로 드러낸다: 등록 0개 / 세션 없음 / fetch 0건 / push 실패.
  // 이 [watch] 라인들은 상주 로그(qualiflow-agent.log 등)에 남아 소유자가 게이트를 즉시 짚는다.
  const accounts = await listAccounts();
  if (!accounts.length) {
    // 0개면 왜인지 힌트: 등록부 경로. 배포본은 QUALIFLOW_HOME 기준, 개발은 레포 기준(accounts.ts).
    console.log(
      `[watch] 등록 계정 0개 — 등록부가 비었거나 경로 불일치. QUALIFLOW_HOME=${process.env.QUALIFLOW_HOME ?? "(미설정: 레포 기준 경로 사용)"}`
    );
  } else {
    console.log(`[watch] 등록 계정 ${accounts.length}개: ${accounts.map((a) => `${a.channel}/${a.label}`).join(", ")}`);
    // 계정별 세션 유무를 관측 로그로만 남긴다(스킵 판정 자체는 각 커넥터가 하므로 동작 불변).
    for (const account of accounts) {
      const has = await hasSession(account.channel, account.label);
      console.log(
        `[watch] ${account.channel}/${account.label} 세션 ${has ? "있음" : "없음(로그인 안 됨 → 커넥터가 스킵할 수 있음)"}`
      );
    }
  }

  const summaries = await fetchAllAccounts({ cached: false });
  for (const summary of summaries) {
    console.log(`[watch] ${summary.channel}/${summary.label} 새 대화 ${summary.conversationCount}건 fetch (메시지 ${summary.messageCount})`);
  }

  // push: 페어링됐을 때만 클라우드로 올린다. 미페어링/토큰없음/HTTP실패는 조용히 넘기지 않고 사유를 로그.
  try {
    const results = await pushAllAccounts();
    for (const result of results) {
      if (result.status === "pushed") {
        console.log(`[watch] ingest push → ok (${result.channel}/${result.label}) ${result.detail}`);
      } else if (result.status === "skipped") {
        console.log(`[watch] ingest push → 스킵 (${result.channel}/${result.label}) 사유: ${result.detail}`);
      } else {
        console.error(`[watch] ingest push → 실패 (${result.channel}/${result.label}) 사유: ${result.detail}`);
      }
    }
  } catch (error) {
    if (error instanceof NotPairedError) {
      console.log("[watch] ingest push → 실패(미페어링) — 클라우드에 안 올라감. 'pair <코드>'로 연결하면 자동 동기화됩니다.");
    } else {
      // ★push 실패는 백오프시키지 않는다 — fetch는 이미 .data에 저장돼 유실 없고, push만 다음 사이클에
      //   재시도한다. 예전엔 throw해서 push 장애가 fetch 주기(최대 30분)까지 끌어내렸다(실시간성 저하). 분리.
      console.error(`[watch] ingest push → 실패(다음 사이클 재시도): ${error instanceof Error ? error.message : String(error)}`);
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
      // 롱폴 연결이 프록시에 끊기거나(fetch failed) abort 된 것은 '정상' 재연결 대상 —
      //   에러로 도배하지 않고 곧바로 다시 건다. 그 외 진짜 에러만 로그 + 5초 백오프.
      const msg = error instanceof Error ? error.message : String(error);
      const transient =
        (error instanceof Error && error.name === "AbortError") ||
        /fetch failed|terminated|other side closed|ECONNRESET|socket hang up|network/i.test(msg);
      if (transient) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      console.error("명령 폴 실패:", msg);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
