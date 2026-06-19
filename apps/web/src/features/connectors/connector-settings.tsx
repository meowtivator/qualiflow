"use client";

import Image from "next/image";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

type ConnectorDefinition = {
  id: string;
  name: string;
  logoUrl: string;
  connectUrl: string;
};

const CONNECTORS: ConnectorDefinition[] = [
  {
    id: "alibaba",
    name: "Alibaba",
    logoUrl: "https://cdn.simpleicons.org/alibabadotcom/FF6A00",
    connectUrl: "https://onetalk.alibaba.com/"
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    logoUrl: "https://cdn.simpleicons.org/whatsapp/25D366",
    connectUrl: "https://web.whatsapp.com/"
  },
  {
    id: "telegram",
    name: "Telegram",
    logoUrl: "https://cdn.simpleicons.org/telegram/26A5E4",
    connectUrl: "https://web.telegram.org/"
  },
  {
    id: "instagram",
    name: "Instagram",
    logoUrl: "https://cdn.simpleicons.org/instagram/E4405F",
    connectUrl: "https://www.instagram.com/direct/inbox/"
  }
];

type ConnectorStatus = "idle" | "checking" | "connected" | "needs_relogin" | "error";

type ConnectorState = {
  checkedAt?: string;
  detail?: string;
  openedAt?: string;
  status: ConnectorStatus;
};

type ConnectorStateMap = Record<string, ConnectorState>;

type ToastState = {
  id: number;
  message: string;
  tone: "success" | "info" | "warning";
};

type ConnectorStatusResponse = {
  checkedAt: string;
  detail: string;
  source: "connection_status" | "runtime_missing";
  status: "disconnected" | "active" | "needs_relogin" | "error";
};

const STORAGE_KEY = "qualiflow.connectorStates.v2";
const CONNECTOR_STATE_EVENT = "qualiflow:connector-state";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 60_000;

function parseConnectorStates(rawValue: string | null): ConnectorStateMap {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as ConnectorStateMap;

    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readConnectorStates(): ConnectorStateMap {
  if (typeof window === "undefined") {
    return {};
  }

  return parseConnectorStates(window.localStorage.getItem(STORAGE_KEY));
}

function getConnectorStateSnapshot() {
  if (typeof window === "undefined") {
    return "{}";
  }

  return window.localStorage.getItem(STORAGE_KEY) ?? "{}";
}

function subscribeConnectorStates(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CONNECTOR_STATE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CONNECTOR_STATE_EVENT, onStoreChange);
  };
}

function formatCheckedAt(value?: string) {
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

function getStatusLabel(status: ConnectorStatus) {
  switch (status) {
    case "checking":
      return "확인 중";
    case "connected":
      return "연결됨";
    case "needs_relogin":
      return "확인 필요";
    case "error":
      return "오류";
    default:
      return undefined;
  }
}

function getConnectorDescription(status: ConnectorStatus, state?: ConnectorState) {
  const checkedAt = formatCheckedAt(state?.checkedAt);

  if (status === "connected" && checkedAt) {
    return `${checkedAt} 서버 확인 완료`;
  }

  if (status === "checking") {
    return state?.detail ?? "로그인 완료 여부를 자동으로 확인하고 있습니다.";
  }

  if (status === "needs_relogin") {
    return state?.detail ?? "아직 연결 상태를 확인하지 못했습니다. 로그인 창을 다시 열어주세요.";
  }

  if (status === "error") {
    return state?.detail ?? "연결 상태 확인 중 문제가 발생했습니다.";
  }

  if (status === "idle" && state?.detail) {
    return state.detail;
  }

  return "계정 로그인 후 서버가 연결 상태를 자동으로 확인합니다.";
}

export function ConnectorSettings() {
  const connectorStateSnapshot = useSyncExternalStore(subscribeConnectorStates, getConnectorStateSnapshot, () => "{}");
  const connectorStates = useMemo(() => parseConnectorStates(connectorStateSnapshot), [connectorStateSnapshot]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastIdRef = useRef(0);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3200);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  const updateConnectorState = (connectorId: string, state: ConnectorState) => {
    const nextStates = {
      ...readConnectorStates(),
      [connectorId]: state
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStates));
    window.dispatchEvent(new Event(CONNECTOR_STATE_EVENT));
  };

  const checkConnectorStatus = async (
    connector: ConnectorDefinition,
    options: { keepIdleOnMissing?: boolean; notifyOnActive?: boolean } = {}
  ) => {
    try {
      const response = await fetch(`/api/connectors/status?channel=${encodeURIComponent(connector.id)}`, {
        cache: "no-store"
      });
      const status = (await response.json()) as ConnectorStatusResponse;
      const currentState = readConnectorStates()[connector.id];

      if (status.status === "active") {
        if (options.notifyOnActive && currentState?.status !== "connected") {
          showToast(`${connector.name} 연결이 확인되었습니다.`, "success");
        }

        updateConnectorState(connector.id, {
          checkedAt: status.checkedAt,
          detail: status.detail,
          status: "connected"
        });
        return;
      }

      if (status.status === "error" || !response.ok) {
        updateConnectorState(connector.id, {
          checkedAt: status.checkedAt,
          detail: status.detail,
          status: "error"
        });
        return;
      }

      if (options.keepIdleOnMissing && !currentState) {
        return;
      }

      if (status.status === "disconnected") {
        if (currentState?.status === "checking" && isStillWithinPollingWindow(currentState.openedAt)) {
          updateConnectorState(connector.id, {
            ...currentState,
            checkedAt: status.checkedAt,
            detail: status.detail,
            status: "checking"
          });
          return;
        }

        updateConnectorState(connector.id, {
          checkedAt: status.checkedAt,
          detail: status.detail,
          status: "idle"
        });
        return;
      }

      if (currentState?.status === "checking" && isStillWithinPollingWindow(currentState.openedAt)) {
        updateConnectorState(connector.id, {
          ...currentState,
          checkedAt: status.checkedAt,
          detail: status.detail,
          status: "checking"
        });
        return;
      }

      updateConnectorState(connector.id, {
        checkedAt: status.checkedAt,
        detail: status.detail,
        status: "needs_relogin"
      });

      if (currentState?.status === "checking") {
        showToast(`${connector.name} 연결을 아직 확인하지 못했습니다. 로그인 상태를 다시 확인해주세요.`, "warning");
      }
    } catch {
      updateConnectorState(connector.id, {
        checkedAt: new Date().toISOString(),
        detail: "연결 상태 확인 API에 접근할 수 없습니다.",
        status: "error"
      });
    }
  };

  const showToast = (message: string, tone: ToastState["tone"] = "info") => {
    toastIdRef.current += 1;
    setToast({
      id: toastIdRef.current,
      message,
      tone
    });
  };

  const handleOpenConnector = (connector: ConnectorDefinition) => {
    window.open(connector.connectUrl, "_blank", "noopener,noreferrer");
    updateConnectorState(connector.id, {
      ...readConnectorStates()[connector.id],
      checkedAt: new Date().toISOString(),
      detail: "로그인 창을 열었습니다. 서버가 연결 상태를 자동으로 확인합니다.",
      openedAt: new Date().toISOString(),
      status: "checking"
    });
    showToast(`${connector.name} 로그인 창을 열었습니다. 연결 여부를 자동으로 확인합니다.`);
    void checkConnectorStatus(connector, { notifyOnActive: true });
  };

  useEffect(() => {
    for (const connector of CONNECTORS) {
      void checkConnectorStatus(connector, { keepIdleOnMissing: true });
    }
    // 최초 진입 시 서버 상태를 한 번 당겨오는 용도라 의존성은 비워둔다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const checkingConnectors = CONNECTORS.filter((connector) => connectorStates[connector.id]?.status === "checking");

    if (checkingConnectors.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      for (const connector of checkingConnectors) {
        void checkConnectorStatus(connector, { notifyOnActive: true });
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
    // connectorStates snapshot 변화에 맞춰 현재 checking 대상만 polling한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectorStateSnapshot]);

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
          const connectorState = connectorStates[connector.id];
          const status = connectorState?.status ?? "idle";
          const statusLabel = getStatusLabel(status);

          return (
            <article
              className={`connector-card ${status}`}
              data-connector-id={connector.id}
              key={connector.id}
            >
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
                  {statusLabel ? (
                    <span className={`connector-status ${status}`}>
                      {status === "connected" ? <CheckCircle2 size={14} /> : null}
                      {status === "checking" ? <Loader2 className="connector-status-spinner" size={14} /> : null}
                      {statusLabel}
                    </span>
                  ) : null}
                </div>
                <p>{getConnectorDescription(status, connectorState)}</p>
              </div>
              <div className="connector-actions">
                <button
                  className={`connector-connect-button ${status === "connected" || status === "checking" ? "secondary" : ""}`}
                  data-testid={`connector-open-${connector.id}`}
                  onClick={() => handleOpenConnector(connector)}
                  type="button"
                >
                  {status === "connected" ? "변경하기" : status === "checking" ? "다시 열기" : "연결"}
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
