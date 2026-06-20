"use client";

import Image from "next/image";
import { CheckCircle2, ExternalLink, Loader2, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

type ConnectorDefinition = {
  authMode: string;
  id: string;
  name: string;
  logoUrl: string;
  connectUrl: string;
};

const CONNECTORS: ConnectorDefinition[] = [
  {
    authMode: "browser_session",
    id: "alibaba",
    name: "Alibaba",
    logoUrl: "https://cdn.simpleicons.org/alibabadotcom/FF6A00",
    connectUrl: "https://onetalk.alibaba.com/"
  },
  {
    authMode: "qr_pairing",
    id: "whatsapp",
    name: "WhatsApp",
    logoUrl: "https://cdn.simpleicons.org/whatsapp/25D366",
    connectUrl: "https://web.whatsapp.com/"
  },
  {
    authMode: "phone_code",
    id: "telegram",
    name: "Telegram",
    logoUrl: "https://cdn.simpleicons.org/telegram/26A5E4",
    connectUrl: "https://web.telegram.org/"
  },
  {
    authMode: "browser_session",
    id: "instagram",
    name: "Instagram",
    logoUrl: "https://cdn.simpleicons.org/instagram/E4405F",
    connectUrl: "https://www.instagram.com/direct/inbox/"
  }
];

type RuntimeStatus = "disconnected" | "active" | "needs_relogin" | "error";
type ConnectionStatus = RuntimeStatus | "checking";

type RuntimeConnection = {
  accountKind?: string;
  accountLabel: string;
  authMode?: string;
  capabilities?: string[];
  channel: string;
  checkedAt: string;
  detail: string;
  externalAccountId?: string;
  id: string;
  lastSyncedAt?: string;
  ownerLabel?: string;
  ownerUserId?: string;
  source: "connection_status" | "runtime_missing";
  status: RuntimeStatus;
};

type PendingConnection = Omit<RuntimeConnection, "source" | "status"> & {
  openedAt: string;
  source: "local_pending";
  status: "checking" | "needs_relogin" | "error";
};

type ConnectorListResponse = {
  checkedAt: string;
  connections: RuntimeConnection[];
};

type ToastState = {
  id: number;
  message: string;
  tone: "success" | "info" | "warning";
};

const PENDING_CONNECTIONS_KEY = "qualiflow.pendingConnectorConnections.v1";
const PENDING_CONNECTION_EVENT = "qualiflow:pending-connector-connections";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 60_000;

function parsePendingConnections(rawValue: string | null): PendingConnection[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as PendingConnection[];

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readPendingConnections(): PendingConnection[] {
  if (typeof window === "undefined") {
    return [];
  }

  return parsePendingConnections(window.localStorage.getItem(PENDING_CONNECTIONS_KEY));
}

function getPendingConnectionsSnapshot() {
  if (typeof window === "undefined") {
    return "[]";
  }

  return window.localStorage.getItem(PENDING_CONNECTIONS_KEY) ?? "[]";
}

function subscribePendingConnections(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(PENDING_CONNECTION_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(PENDING_CONNECTION_EVENT, onStoreChange);
  };
}

function writePendingConnections(connections: PendingConnection[]) {
  window.localStorage.setItem(PENDING_CONNECTIONS_KEY, JSON.stringify(connections));
  window.dispatchEvent(new Event(PENDING_CONNECTION_EVENT));
}

function upsertPendingConnection(connection: PendingConnection) {
  const nextConnections = [
    ...readPendingConnections().filter((item) => item.id !== connection.id),
    connection
  ];

  writePendingConnections(nextConnections);
}

function removePendingConnection(connectionId: string) {
  writePendingConnections(readPendingConnections().filter((item) => item.id !== connectionId));
}

function formatDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function isStillWithinPollingWindow(value?: string) {
  if (!value) {
    return false;
  }

  const openedAt = new Date(value).getTime();

  return Number.isFinite(openedAt) && Date.now() - openedAt < POLL_TIMEOUT_MS;
}

function createConnectionId(channel: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${channel}:${crypto.randomUUID()}`;
  }

  return `${channel}:${Date.now()}`;
}

function getStatusLabel(status: ConnectionStatus) {
  switch (status) {
    case "active":
      return "연결됨";
    case "checking":
      return "확인 중";
    case "needs_relogin":
      return "확인 필요";
    case "error":
      return "오류";
    default:
      return "미연결";
  }
}

function getConnectionDetail(connection: RuntimeConnection | PendingConnection) {
  if (connection.status === "active") {
    const syncedAt = formatDate(connection.lastSyncedAt ?? connection.checkedAt);
    return syncedAt ? `${syncedAt} 확인` : "런타임이 연결 상태를 확인했습니다.";
  }

  return connection.detail;
}

function mergeConnections(runtimeConnections: RuntimeConnection[], pendingConnections: PendingConnection[]) {
  const runtimeIds = new Set(runtimeConnections.map((connection) => connection.id));

  return [
    ...runtimeConnections,
    ...pendingConnections.filter((connection) => !runtimeIds.has(connection.id))
  ];
}

export function ConnectorSettings() {
  const pendingSnapshot = useSyncExternalStore(subscribePendingConnections, getPendingConnectionsSnapshot, () => "[]");
  const pendingConnections = useMemo(() => parsePendingConnections(pendingSnapshot), [pendingSnapshot]);
  const [runtimeConnections, setRuntimeConnections] = useState<RuntimeConnection[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastIdRef = useRef(0);

  const visibleConnections = useMemo(
    () => mergeConnections(runtimeConnections, pendingConnections),
    [runtimeConnections, pendingConnections]
  );

  const showToast = (message: string, tone: ToastState["tone"] = "info") => {
    toastIdRef.current += 1;
    setToast({
      id: toastIdRef.current,
      message,
      tone
    });
  };

  const refreshRuntimeConnections = async (options: { notifyActiveIds?: string[] } = {}) => {
    try {
      const response = await fetch("/api/connectors/status", { cache: "no-store" });
      const payload = (await response.json()) as ConnectorListResponse;
      const connections = Array.isArray(payload.connections) ? payload.connections : [];
      const notifyActiveIds = new Set(options.notifyActiveIds ?? []);

      setRuntimeConnections(connections);

      for (const connection of connections) {
        if (connection.status === "active" && notifyActiveIds.has(connection.id)) {
          removePendingConnection(connection.id);
          showToast(`${connection.accountLabel} 연결이 확인되었습니다.`, "success");
        }
      }
    } catch {
      showToast("연결 상태 목록을 불러오지 못했습니다.", "warning");
    }
  };

  const checkPendingConnection = async (connection: PendingConnection, options: { notifyOnActive?: boolean } = {}) => {
    try {
      const response = await fetch(
        `/api/connectors/status?channel=${encodeURIComponent(connection.channel)}&connectionId=${encodeURIComponent(connection.id)}`,
        { cache: "no-store" }
      );
      const status = (await response.json()) as RuntimeConnection;

      if (status.status === "active") {
        removePendingConnection(connection.id);
        await refreshRuntimeConnections({ notifyActiveIds: options.notifyOnActive ? [connection.id] : [] });
        return;
      }

      if (status.status === "error" || !response.ok) {
        upsertPendingConnection({
          ...connection,
          checkedAt: status.checkedAt,
          detail: status.detail,
          status: "error"
        });
        return;
      }

      if (isStillWithinPollingWindow(connection.openedAt)) {
        upsertPendingConnection({
          ...connection,
          checkedAt: status.checkedAt,
          detail: "로그인 창은 열렸고, connector runtime의 연결 완료 보고를 기다리고 있습니다.",
          status: "checking"
        });
        return;
      }

      upsertPendingConnection({
        ...connection,
        checkedAt: status.checkedAt,
        detail: "브라우저 로그인만으로는 앱이 연결을 확정할 수 없습니다. connector runtime이 상태를 보고해야 합니다.",
        status: "needs_relogin"
      });

      if (options.notifyOnActive) {
        showToast(`${connection.accountLabel} 연결을 아직 확인하지 못했습니다.`, "warning");
      }
    } catch {
      upsertPendingConnection({
        ...connection,
        checkedAt: new Date().toISOString(),
        detail: "연결 상태 확인 API에 접근할 수 없습니다.",
        status: "error"
      });
    }
  };

  const handleAddConnection = (connector: ConnectorDefinition) => {
    const now = new Date().toISOString();
    const connection: PendingConnection = {
      accountKind: "user_account",
      accountLabel: `새 ${connector.name} 계정`,
      authMode: connector.authMode,
      channel: connector.id,
      checkedAt: now,
      detail: "로그인 창을 열었습니다. connector runtime의 연결 완료 보고를 기다립니다.",
      id: createConnectionId(connector.id),
      openedAt: now,
      ownerLabel: "현재 사용자",
      source: "local_pending",
      status: "checking"
    };

    upsertPendingConnection(connection);
    window.open(connector.connectUrl, "_blank", "noopener,noreferrer");
    showToast(`${connector.name} 로그인 창을 열었습니다. 연결 상태는 자동으로 확인합니다.`);
    void checkPendingConnection(connection, { notifyOnActive: true });
  };

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3200);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshRuntimeConnections(), 0);

    return () => window.clearTimeout(timeout);
    // 최초 진입 시 런타임 연결 목록을 한 번 가져온다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const checkingConnections = pendingConnections.filter((connection) => connection.status === "checking");

    if (checkingConnections.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      for (const connection of checkingConnections) {
        void checkPendingConnection(connection, { notifyOnActive: true });
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
    // pendingSnapshot이 바뀔 때 현재 확인 중인 connection만 다시 polling한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSnapshot]);

  return (
    <section className="connectors-page" aria-label="Channel connector settings">
      {toast ? (
        <div className={`connector-toast ${toast.tone}`} data-testid="connector-toast" key={toast.id} role="status">
          <CheckCircle2 size={16} />
          <span>{toast.message}</span>
        </div>
      ) : null}

      <div className="connector-grid">
        {CONNECTORS.map((connector) => {
          const connections = visibleConnections.filter((connection) => connection.channel === connector.id);
          const activeCount = connections.filter((connection) => connection.status === "active").length;

          return (
            <article className="connector-card" data-connector-id={connector.id} key={connector.id}>
              <div className="connector-logo-wrap">
                <Image
                  alt=""
                  className="connector-logo-image"
                  height={42}
                  src={connector.logoUrl}
                  unoptimized
                  width={42}
                />
              </div>
              <div className="connector-copy">
                <div className="connector-title-line">
                  <h2>{connector.name}</h2>
                  <span className="connector-service-summary">
                    {connections.length === 0 ? "연결 계정 없음" : `${activeCount}/${connections.length} 연결`}
                  </span>
                </div>
                <p>사용자별로 여러 계정을 연결하고, 계정별 상태를 따로 확인합니다.</p>
                {connections.length > 0 ? (
                  <div className="connector-account-list">
                    {connections.map((connection) => (
                      <div className="connector-account-row" data-connection-id={connection.id} key={connection.id}>
                        <div className="connector-account-main">
                          <strong>{connection.accountLabel}</strong>
                          <span>{connection.ownerLabel ?? connection.ownerUserId ?? "소유자 미지정"}</span>
                        </div>
                        <div className="connector-account-meta">
                          <span className={`connector-status ${connection.status}`}>
                            {connection.status === "active" ? <CheckCircle2 size={14} /> : null}
                            {connection.status === "checking" ? (
                              <Loader2 className="connector-status-spinner" size={14} />
                            ) : null}
                            {getStatusLabel(connection.status)}
                          </span>
                          <span>{getConnectionDetail(connection)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="connector-empty-state">아직 등록된 계정이 없습니다.</div>
                )}
              </div>
              <div className="connector-actions">
                <button
                  className="connector-connect-button"
                  data-testid={`connector-add-${connector.id}`}
                  onClick={() => handleAddConnection(connector)}
                  type="button"
                >
                  계정 추가
                  <Plus size={14} />
                  <ExternalLink size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
