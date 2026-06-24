"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Cpu, KeyRound, Loader2, Plus, RefreshCw } from "lucide-react";

export type AgentRow = {
  id: string;
  label: string;
  platform: string | null;
  paired_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type AgentConnectorProps = {
  devMode: boolean;
  isAuthed: boolean;
  agents: AgentRow[];
};

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function AgentConnector({ devMode, isAuthed, agents }: AgentConnectorProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string | null } | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  async function devLogin() {
    setBusy("login");
    setMessage(null);
    try {
      const res = await fetch("/api/dev/login", { method: "POST" });
      if (!res.ok) {
        throw new Error("dev 로그인 실패(QUALIFLOW_DEV_SEED_LOGIN / SUPABASE_SECRET_KEY 확인).");
      }
      router.refresh();
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "dev 로그인 실패" });
    } finally {
      setBusy(null);
    }
  }

  async function issueCode() {
    setBusy("issue");
    setMessage(null);
    try {
      const res = await fetch("/api/agents/pairing-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "내 데스크톱 에이전트" })
      });
      const data = (await res.json()) as { ok?: boolean; code?: string; expiresAt?: string; message?: string };
      if (!res.ok || !data.ok || !data.code) {
        throw new Error(data.message ?? "코드 발급 실패");
      }
      setCode({ code: data.code, expiresAt: data.expiresAt ?? null });
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "코드 발급 실패" });
    } finally {
      setBusy(null);
    }
  }

  async function simulatePair() {
    if (!code) {
      return;
    }
    setBusy("pair");
    setMessage(null);
    try {
      const res = await fetch("/api/agents/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.code, label: "브라우저 시뮬레이트", platform: "web-sim" })
      });
      const data = (await res.json()) as { ok?: boolean; agentId?: string; message?: string };
      if (!res.ok || !data.ok || !data.agentId) {
        throw new Error(data.message ?? "페어링 실패");
      }
      setCode(null);
      setMessage({ tone: "ok", text: `에이전트가 연결되어 DB에 저장됐습니다 (id ${data.agentId.slice(0, 8)}…).` });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "페어링 실패" });
    } finally {
      setBusy(null);
    }
  }

  if (!isAuthed) {
    return (
      <section className="agents-page" aria-label="Agent connector">
        <div className="agents-empty-auth">
          <Cpu size={22} />
          <h2>에이전트를 연결하려면 로그인이 필요합니다</h2>
          <p>페어링 코드는 로그인된 워크스페이스에 묶여 발급됩니다.</p>
          {devMode ? (
            <button className="agent-primary-button" disabled={busy === "login"} onClick={() => void devLogin()} type="button">
              {busy === "login" ? <Loader2 className="agent-spin" size={16} /> : <KeyRound size={16} />}
              dev 시드 로그인
            </button>
          ) : (
            <a className="agent-primary-button" href="/login">
              로그인으로 이동
            </a>
          )}
          {message ? <p className={`agent-inline-message ${message.tone}`}>{message.text}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="agents-page" aria-label="Agent connector">
      <div className="agent-connect-card">
        <div className="agent-connect-head">
          <div>
            <h2>새 에이전트 연결</h2>
            <p>코드를 발급해 데스크톱 에이전트에 입력하면, 에이전트가 이 워크스페이스에 등록(저장)됩니다.</p>
          </div>
          <button className="agent-primary-button" disabled={busy === "issue"} onClick={() => void issueCode()} type="button">
            {busy === "issue" ? <Loader2 className="agent-spin" size={16} /> : <Plus size={16} />}
            페어링 코드 발급
          </button>
        </div>

        {code ? (
          <div className="agent-code-box">
            <div className="agent-code-value" data-testid="pairing-code">
              {code.code}
            </div>
            <div className="agent-code-meta">
              <span>만료: {formatDateTime(code.expiresAt)}</span>
              <span>이 코드를 데스크톱 에이전트에 입력하세요. (에이전트 앱은 다음 단계 PR3)</span>
            </div>
            {devMode ? (
              <button
                className="agent-secondary-button"
                data-testid="simulate-pair"
                disabled={busy === "pair"}
                onClick={() => void simulatePair()}
                type="button"
              >
                {busy === "pair" ? <Loader2 className="agent-spin" size={14} /> : <Cpu size={14} />}
                (데모) 이 브라우저로 페어링
              </button>
            ) : null}
          </div>
        ) : null}

        {message ? <p className={`agent-inline-message ${message.tone}`}>{message.text}</p> : null}
      </div>

      <div className="agent-list-card">
        <div className="agent-list-head">
          <h3>연결된 에이전트 ({agents.length})</h3>
          <button className="agent-ghost-button" onClick={() => router.refresh()} type="button" aria-label="새로고침">
            <RefreshCw size={14} />
          </button>
        </div>
        {agents.length === 0 ? (
          <div className="agent-list-empty">아직 연결된 에이전트가 없습니다. 코드를 발급해 연결하세요.</div>
        ) : (
          <table className="agent-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>플랫폼</th>
                <th>페어링</th>
                <th>마지막 접속</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} data-testid="agent-row">
                  <td>{agent.label}</td>
                  <td>{agent.platform ?? "—"}</td>
                  <td>{formatDateTime(agent.paired_at)}</td>
                  <td>{formatDateTime(agent.last_seen_at)}</td>
                  <td>
                    <span className={`agent-status ${agent.revoked_at ? "revoked" : "active"}`}>
                      {agent.revoked_at ? "해제됨" : "연결됨"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
