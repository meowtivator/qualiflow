type ConnectorStatus = "available" | "planned" | "spike";

type ConnectorDefinition = {
  id: string;
  name: string;
  brandClass: string;
  logoText: string;
  status: ConnectorStatus;
  authMode: string;
  runtime: string;
  description: string;
  steps: string[];
  command?: string;
  note: string;
};

const CONNECTORS: ConnectorDefinition[] = [
  {
    id: "alibaba",
    name: "Alibaba",
    brandClass: "alibaba",
    logoText: "A",
    status: "available",
    authMode: "Seller account browser session",
    runtime: "Playwright storageState",
    description: "OneTalk에 로그인한 운영자 계정 세션으로 inquiry 메시지를 추출합니다.",
    steps: [
      "headed browser에서 Alibaba seller 계정으로 로그인합니다.",
      "로그인 완료 후 runtime이 `.auth/alibaba.storage.json`에 세션을 저장합니다.",
      "recorder/extractor가 OneTalk 대화를 읽어 QualiFlow inbox 모델로 변환합니다."
    ],
    command: "pnpm --filter @qualiflow/adapter-alibaba inquiry:login",
    note: "현재 가장 먼저 실사용 검증하는 채널입니다. 세션 만료 시 같은 흐름으로 재로그인합니다."
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    brandClass: "whatsapp",
    logoText: "WA",
    status: "spike",
    authMode: "QR pairing or Business API",
    runtime: "Runtime-only QR/session store",
    description: "QR로 연결된 사용자 세션 또는 Business API 이벤트를 같은 메시지 모델로 정규화합니다.",
    steps: [
      "빠른 실험은 WhatsApp Web QR pairing으로 시작합니다.",
      "운영 배포는 고객사 업무 계정의 WhatsApp Business/Cloud API 연결을 우선 검토합니다.",
      "runtime이 contact/chat/message snapshot을 만들고 adapter가 lead/thread/message로 변환합니다."
    ],
    note: "QR session은 빠르지만 안정성·정책 리스크가 있어 운영 전 Business API 경로를 같이 검증해야 합니다."
  },
  {
    id: "telegram",
    name: "Telegram",
    brandClass: "telegram",
    logoText: "TG",
    status: "spike",
    authMode: "Phone code user session",
    runtime: "MTProto / TDLib / gotd",
    description: "Bot API가 아니라 운영자 Telegram 계정에 실제로 보이는 dialog를 가져옵니다.",
    steps: [
      "운영자 전화번호를 입력하고 Telegram 앱으로 받은 인증 코드를 입력합니다.",
      "2FA가 켜져 있으면 password를 추가로 입력합니다.",
      "runtime이 user session을 저장하고 dialog/message snapshot을 adapter에 넘깁니다."
    ],
    note: "Bot API는 bot이 참여한 대화만 볼 수 있으므로 이 제품 목표에는 맞지 않습니다."
  },
  {
    id: "instagram",
    name: "Instagram",
    brandClass: "instagram",
    logoText: "IG",
    status: "available",
    authMode: "Meta OAuth or browser session",
    runtime: "Professional account connector",
    description: "Instagram professional account의 DM 이벤트를 buyer inbox로 가져오는 경로입니다.",
    steps: [
      "장기 운영은 Meta professional account OAuth 연결을 우선합니다.",
      "고객사 Instagram 계정을 Meta Business에 연결하고 필요한 permission을 승인합니다.",
      "runtime이 conversation/message event를 가져오고 adapter가 공통 chat 모델로 정규화합니다."
    ],
    note: "브라우저 세션 collector는 가능성 검증용으로만 두고, 운영은 Meta 공식 경로를 우선합니다."
  }
];

const STATUS_LABELS: Record<ConnectorStatus, string> = {
  available: "Adapter ready",
  planned: "Planned",
  spike: "Runtime spike"
};

export function ConnectorSettings() {
  return (
    <section className="connectors-page" aria-label="Channel connector settings">
      <div className="connectors-hero">
        <div>
          <span className="eyebrow">Channel plugins</span>
          <h2>계정 연동 설정</h2>
          <p>
            채널별 로그인은 connector runtime이 처리하고, adapter는 가져온 대화 데이터를 QualiFlow inbox
            모델로 정규화합니다. 이 화면은 실제 계정 연결을 시작하기 위한 설정 진입점입니다.
          </p>
        </div>
        <div className="connectors-note">
          <strong>용어</strong>
          <span>좌측 하단 버튼은 보통 sidebar footer action 또는 utility nav item이라고 부릅니다.</span>
        </div>
      </div>

      <div className="connector-grid">
        {CONNECTORS.map((connector) => (
          <article className="connector-card" key={connector.id}>
            <div className="connector-card-header">
              <div className={`connector-logo ${connector.brandClass}`} aria-hidden="true">
                {connector.logoText}
              </div>
              <div>
                <h3>{connector.name}</h3>
                <span>{STATUS_LABELS[connector.status]}</span>
              </div>
            </div>

            <p>{connector.description}</p>

            <dl className="connector-meta">
              <div>
                <dt>Auth</dt>
                <dd>{connector.authMode}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>{connector.runtime}</dd>
              </div>
            </dl>

            <details className="connector-details">
              <summary>
                <span>연결 시작</span>
              </summary>
              <div className="connector-steps">
                <ol>
                  {connector.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {connector.command ? (
                  <div className="command-block">
                    <span>Local command</span>
                    <code>{connector.command}</code>
                  </div>
                ) : null}
                <p>{connector.note}</p>
              </div>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
