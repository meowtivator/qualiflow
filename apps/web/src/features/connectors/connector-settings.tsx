"use client";

import Image from "next/image";
import { CheckCircle2, ExternalLink } from "lucide-react";
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

type ConnectorStatus = "idle" | "pending" | "connected";

type ConnectorState = {
  connectedAt?: string;
  status: ConnectorStatus;
};

type ConnectorStateMap = Record<string, ConnectorState>;

type ToastState = {
  id: number;
  message: string;
  tone: "success" | "info";
};

const STORAGE_KEY = "qualiflow.connectorStates.v1";
const CONNECTOR_STATE_EVENT = "qualiflow:connector-state";

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

function formatConnectedAt(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
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
      ...connectorStates[connector.id],
      status: "pending"
    });
    showToast(`${connector.name} 로그인 창을 열었습니다. 완료 후 이 화면에서 완료 처리해주세요.`);
  };

  const handleCompleteConnector = (connector: ConnectorDefinition) => {
    updateConnectorState(connector.id, {
      connectedAt: new Date().toISOString(),
      status: "connected"
    });
    showToast(`${connector.name} 연결이 완료되었습니다.`, "success");
  };

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
          const connectedAt = formatConnectedAt(connectorState?.connectedAt);

          return (
            <article
              className={`connector-card ${status === "connected" ? "connected" : ""}`}
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
                  {status === "connected" ? (
                    <span className="connector-status connected">
                      <CheckCircle2 size={14} />
                      연결됨
                    </span>
                  ) : status === "pending" ? (
                    <span className="connector-status pending">확인 대기</span>
                  ) : null}
                </div>
                <p>
                  {status === "connected" && connectedAt
                    ? `${connectedAt} 연결`
                    : status === "pending"
                      ? "새 창에서 로그인 완료 후 완료 처리해주세요."
                      : "계정 로그인 후 메시지 수집 준비 상태로 표시합니다."}
                </p>
              </div>
              <div className="connector-actions">
                {status === "pending" ? (
                  <>
                    <button
                      className="connector-connect-button success"
                      data-testid={`connector-complete-${connector.id}`}
                      onClick={() => handleCompleteConnector(connector)}
                      type="button"
                    >
                      완료 처리
                    </button>
                    <button
                      className="connector-connect-button secondary"
                      data-testid={`connector-open-${connector.id}`}
                      onClick={() => handleOpenConnector(connector)}
                      type="button"
                    >
                      다시 열기
                    </button>
                  </>
                ) : (
                  <button
                    className={`connector-connect-button ${status === "connected" ? "secondary" : ""}`}
                    data-testid={`connector-open-${connector.id}`}
                    onClick={() => handleOpenConnector(connector)}
                    type="button"
                  >
                    {status === "connected" ? "변경하기" : "연결"}
                    <ExternalLink size={14} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
