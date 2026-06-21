"use client";

import Image from "next/image";
import { CheckCircle2, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

type ConnectorDefinition = {
  authMode: string;
  id: string;
  name: string;
  logoUrl: string;
  connectUrl: string;
  connectHint: string;
  webLaunchable?: boolean;
};

const CONNECTORS: ConnectorDefinition[] = [
  {
    authMode: "browser_session",
    id: "alibaba",
    name: "Alibaba",
    logoUrl: "https://cdn.simpleicons.org/alibabadotcom/FF6A00",
    connectUrl: "https://onetalk.alibaba.com/",
    connectHint: "전용 Chrome 프로필에서 로그인한 뒤 inquiry extractor가 연결 상태를 기록합니다."
  },
  {
    authMode: "qr_pairing",
    id: "whatsapp",
    name: "WhatsApp",
    logoUrl: "https://cdn.simpleicons.org/whatsapp/25D366",
    connectUrl: "https://web.whatsapp.com/",
    connectHint: "WhatsApp Web 세션을 런타임이 확인하고 상태 파일을 기록해야 연결됩니다."
  },
  {
    authMode: "phone_code",
    id: "telegram",
    name: "Telegram",
    logoUrl: "https://cdn.simpleicons.org/telegram/26A5E4",
    connectUrl: "https://web.telegram.org/",
    connectHint: "MTProto/TDLib 런타임이 사용자 계정을 인증하고 상태를 보고해야 연결됩니다."
  },
  {
    authMode: "browser_session",
    id: "instagram",
    name: "Instagram",
    logoUrl: "https://cdn.simpleicons.org/instagram/E4405F",
    connectUrl: "https://www.instagram.com/direct/inbox/",
    connectHint: "계정 추가를 누르면 전용 브라우저 창이 열리고, Direct inbox가 보이면 자동으로 연결됩니다.",
    webLaunchable: true
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

type ConnectorLaunchResponse = {
  message?: string;
  ok: boolean;
};

type ToastState = {
  id: number;
  message: string;
  tone: "success" | "info" | "warning";
};

type RemovalDataPolicy = "keep" | "delete";

const PENDING_CONNECTIONS_KEY = "qualiflow.pendingConnectorConnections.v1";
const PENDING_CONNECTION_EVENT = "qualiflow:pending-connector-connections";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60_000;

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

function removePendingConnectionsByChannel(channel: string) {
  writePendingConnections(readPendingConnections().filter((item) => item.channel !== channel));
}

function isPendingConnection(connection: RuntimeConnection | PendingConnection): connection is PendingConnection {
  return connection.source === "local_pending";
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

function createSafeDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
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
  const activeChannelCounts = runtimeConnections.reduce<Record<string, number>>((counts, connection) => {
    if (connection.status === "active") {
      counts[connection.channel] = (counts[connection.channel] ?? 0) + 1;
    }

    return counts;
  }, {});

  return [
    ...runtimeConnections,
    ...pendingConnections.filter((connection) => {
      if (runtimeIds.has(connection.id)) {
        return false;
      }

      return activeChannelCounts[connection.channel] !== 1;
    })
  ];
}

export function ConnectorSettings() {
  const pendingSnapshot = useSyncExternalStore(subscribePendingConnections, getPendingConnectionsSnapshot, () => "[]");
  const pendingConnections = useMemo(() => parsePendingConnections(pendingSnapshot), [pendingSnapshot]);
  const [runtimeConnections, setRuntimeConnections] = useState<RuntimeConnection[]>([]);
  const [launchingChannel, setLaunchingChannel] = useState<string | null>(null);
  const [removalTarget, setRemovalTarget] = useState<RuntimeConnection | null>(null);
  const [removalDataPolicy, setRemovalDataPolicy] = useState<RemovalDataPolicy>("keep");
  const [isRemoving, setIsRemoving] = useState(false);
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

      const pending = readPendingConnections();
      const activeByChannel = connections.reduce<Record<string, RuntimeConnection[]>>((grouped, connection) => {
        if (connection.status === "active") {
          grouped[connection.channel] = [...(grouped[connection.channel] ?? []), connection];
        }

        return grouped;
      }, {});

      for (const pendingConnection of pending) {
        const exactMatch = connections.find(
          (connection) => connection.id === pendingConnection.id && connection.status === "active"
        );
        const channelMatch = activeByChannel[pendingConnection.channel]?.length === 1
          ? activeByChannel[pendingConnection.channel][0]
          : undefined;

        if (exactMatch || channelMatch) {
          removePendingConnection(pendingConnection.id);
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
        await refreshRuntimeConnections();

        if (options.notifyOnActive) {
          showToast(`${status.accountLabel} 연결이 확인되었습니다.`, "success");
        }

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

  const handleAddConnection = async (connector: ConnectorDefinition) => {
    const now = new Date().toISOString();
    const runtimeDetail = connector.webLaunchable
      ? "전용 브라우저 창을 여는 중입니다. 로그인 후 Direct inbox가 보이면 자동으로 연결됩니다."
      : "로그인 창은 열렸고, connector runtime의 연결 완료 보고를 기다리고 있습니다.";
    const connection: PendingConnection = {
      accountKind: "user_account",
      accountLabel: `새 ${connector.name} 계정`,
      authMode: connector.authMode,
      channel: connector.id,
      checkedAt: now,
      detail: runtimeDetail,
      id: createConnectionId(connector.id),
      openedAt: now,
      ownerLabel: "현재 사용자",
      source: "local_pending",
      status: "checking"
    };

    upsertPendingConnection(connection);

    if (!connector.webLaunchable) {
      window.open(connector.connectUrl, "_blank", "noopener,noreferrer");
      showToast(`${connector.name} 로그인 창을 열었습니다. 연결 상태는 자동으로 확인합니다.`);
      void checkPendingConnection(connection, { notifyOnActive: true });
      return;
    }

    setLaunchingChannel(connector.id);

    try {
      const response = await fetch("/api/connectors/launch", {
        body: JSON.stringify({ channel: connector.id }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = (await response.json()) as ConnectorLaunchResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "로컬 connector runtime을 실행하지 못했습니다.");
      }

      upsertPendingConnection({
        ...connection,
        detail: "전용 브라우저 창을 열었습니다. 로그인 완료를 자동으로 확인하고 있습니다."
      });
      showToast(`${connector.name} 전용 브라우저 창을 열었습니다. 로그인 완료를 자동으로 확인합니다.`);
      void checkPendingConnection(connection, { notifyOnActive: true });
    } catch (error) {
      upsertPendingConnection({
        ...connection,
        checkedAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : "로컬 connector runtime을 실행하지 못했습니다.",
        status: "error"
      });
      showToast(error instanceof Error ? error.message : "로컬 connector runtime을 실행하지 못했습니다.", "warning");
    } finally {
      setLaunchingChannel(null);
    }
  };

  const handleRemoveConnection = (connection: RuntimeConnection | PendingConnection) => {
    if (isPendingConnection(connection)) {
      removePendingConnection(connection.id);
      showToast(`${connection.accountLabel} 대기 항목을 삭제했습니다.`, "info");
      return;
    }

    setRemovalTarget(connection);
    setRemovalDataPolicy("keep");
  };

  const handleCloseRemovalDialog = () => {
    if (isRemoving) {
      return;
    }

    setRemovalTarget(null);
    setRemovalDataPolicy("keep");
  };

  const handleConfirmRuntimeRemoval = async () => {
    if (!removalTarget) {
      return;
    }

    setIsRemoving(true);

    try {
      const response = await fetch("/api/connectors/status", {
        body: JSON.stringify({
          channel: removalTarget.channel,
          connectionId: removalTarget.id,
          deleteData: removalDataPolicy === "delete"
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "DELETE"
      });
      const payload = (await response.json()) as { message?: string; errors?: string[] };

      if (!response.ok) {
        throw new Error(payload.errors?.[0] ?? payload.message ?? "연결 해제에 실패했습니다.");
      }

      setRuntimeConnections((connections) => connections.filter((connection) => connection.id !== removalTarget.id));
      setRemovalTarget(null);
      setRemovalDataPolicy("keep");

      showToast(
        removalDataPolicy === "delete"
          ? `${removalTarget.accountLabel} 연결과 동기화 데이터를 삭제했습니다.`
          : `${removalTarget.accountLabel} 연결을 해제했습니다.`,
        "success"
      );

      await refreshRuntimeConnections();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "연결 해제에 실패했습니다.", "warning");
    } finally {
      setIsRemoving(false);
    }
  };

  const handleClearPendingConnections = (connector: ConnectorDefinition) => {
    const count = readPendingConnections().filter((connection) => connection.channel === connector.id).length;

    if (count === 0) {
      showToast(`${connector.name} 대기 항목이 없습니다.`);
      return;
    }

    removePendingConnectionsByChannel(connector.id);
    showToast(`${connector.name} 대기 항목 ${count}개를 삭제했습니다.`, "info");
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

      {removalTarget ? (
        <div className="connector-removal-dialog" role="dialog" aria-modal="true" aria-labelledby="connector-removal-title">
          <div className="connector-removal-panel">
            <div>
              <h2 id="connector-removal-title">연결 해제</h2>
              <p>
                {removalTarget.accountLabel} 연결을 해제합니다. 이 계정에서 동기화한 대화 데이터도 함께 삭제할지
                선택하세요.
              </p>
            </div>
            <div className="connector-removal-options" role="radiogroup" aria-label="삭제 범위">
              <button
                className={removalDataPolicy === "keep" ? "active" : ""}
                onClick={() => setRemovalDataPolicy("keep")}
                type="button"
              >
                연결만 해제
                <span>대화/메시지 preview 데이터는 보존합니다.</span>
              </button>
              <button
                className={removalDataPolicy === "delete" ? "active danger" : "danger"}
                onClick={() => setRemovalDataPolicy("delete")}
                type="button"
              >
                연결 + 데이터 삭제
                <span>현재 JSON preview 저장소의 해당 채널 데이터를 같이 삭제합니다.</span>
              </button>
            </div>
            <div className="connector-removal-actions">
              <button className="connector-connect-button secondary" onClick={handleCloseRemovalDialog} type="button">
                취소
              </button>
              <button
                className="connector-connect-button danger"
                disabled={isRemoving}
                onClick={() => void handleConfirmRuntimeRemoval()}
                type="button"
              >
                {isRemoving ? <Loader2 className="connector-status-spinner" size={14} /> : <Trash2 size={14} />}
                해제
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="connector-grid">
        {CONNECTORS.map((connector) => {
          const connections = visibleConnections.filter((connection) => connection.channel === connector.id);
          const activeCount = connections.filter((connection) => connection.status === "active").length;
          const pendingCount = connections.filter(isPendingConnection).length;

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
                <div className="connector-runtime-hint">
                  <span>{connector.connectHint}</span>
                </div>
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
                        <button
                          aria-label={`${connection.accountLabel} 삭제`}
                          className="connector-remove-button"
                          data-testid={`connector-remove-${createSafeDomId(connection.id)}`}
                          onClick={() => handleRemoveConnection(connection)}
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
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
                  disabled={launchingChannel === connector.id}
                  onClick={() => void handleAddConnection(connector)}
                  type="button"
                >
                  {launchingChannel === connector.id ? "실행 중" : "계정 추가"}
                  {launchingChannel === connector.id ? (
                    <Loader2 className="connector-status-spinner" size={14} />
                  ) : (
                    <Plus size={14} />
                  )}
                  <ExternalLink size={14} />
                </button>
                {pendingCount > 0 ? (
                  <button
                    className="connector-connect-button secondary"
                    data-testid={`connector-clear-pending-${connector.id}`}
                    onClick={() => handleClearPendingConnections(connector)}
                    type="button"
                  >
                    대기 정리
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
