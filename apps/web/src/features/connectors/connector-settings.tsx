import Image from "next/image";

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

export function ConnectorSettings() {
  return (
    <section className="connectors-page" aria-label="Channel connector settings">
      <div className="connector-grid">
        {CONNECTORS.map((connector) => (
          <article className="connector-card" key={connector.id}>
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
            <h2>{connector.name}</h2>
            <a className="connector-connect-button" href={connector.connectUrl} rel="noreferrer" target="_blank">
              연결
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
