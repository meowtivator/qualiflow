import {
  CheckCircle2,
  Clock3,
  Globe2,
  Mail,
  MessageSquare,
  Search,
  Send,
  ShieldCheck
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";

import {
  getMockChannelById,
  getMockLeadById,
  getMockQualificationByLeadId,
  mockConversationAdapter,
  mockQualifications
} from "@qualiflow/adapter-mock";
import type { Channel, Lead, Message, Thread } from "@qualiflow/core";

type HomePageProps = {
  searchParams?: Promise<{
    thread?: string | string[];
  }>;
};

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric"
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getMetadataText(value: unknown, fallback = "-") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function getLeadLabel(lead?: Lead) {
  if (!lead) {
    return "Unknown lead";
  }

  return lead.companyName ?? lead.displayName;
}

function getInitials(lead?: Lead) {
  const label = getLeadLabel(lead);
  return label
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getChannelStyle(channel: Channel): CSSProperties {
  return {
    "--channel-color": channel.brandColor ?? "#5e6ad2"
  } as CSSProperties;
}

function ChannelBadge({ channel }: { channel: Channel }) {
  return (
    <span className="channel-badge" style={getChannelStyle(channel)} title={channel.label}>
      {channel.icon.type === "brand" ? channel.label[0] : channel.icon.label[0]}
    </span>
  );
}

function ThreadPreview({ thread, selected }: { thread: Thread; selected: boolean }) {
  const lead = getMockLeadById(thread.leadId);
  const channel = getMockChannelById(thread.channelId);
  const qualification = getMockQualificationByLeadId(thread.leadId);
  const nextAction = getMetadataText(thread.metadata?.nextAction, "다음 액션 확인 필요");

  return (
    <Link className={`thread-row ${selected ? "selected" : ""}`} href={`/?thread=${thread.id}`}>
      <div className="lead-avatar">
        <span>{getInitials(lead)}</span>
        <ChannelBadge channel={channel} />
      </div>
      <div className="thread-copy">
        <div className="thread-title-line">
          <strong>{getLeadLabel(lead)}</strong>
          <span>{formatShortDate(thread.lastMessageAt)}</span>
        </div>
        <div className="thread-meta-line">
          <span className={`grade grade-${qualification?.grade.toLowerCase() ?? "unknown"}`}>
            {qualification?.grade ?? "-"}
          </span>
          <span>{channel.label}</span>
          <span>{lead?.countryCode ?? "N/A"}</span>
        </div>
        <p>{nextAction}</p>
      </div>
    </Link>
  );
}

function MessageBubble({ message }: { message: Message }) {
  return (
    <article className={`message-bubble ${message.direction}`}>
      <div className="message-header">
        <strong>{message.author.displayName}</strong>
        <span>{formatTime(message.sentAt)}</span>
      </div>
      <p>{message.content.text}</p>
    </article>
  );
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const selectedThreadParam = Array.isArray(params?.thread) ? params.thread[0] : params?.thread;
  const [leadPage, threadPage] = await Promise.all([
    mockConversationAdapter.listLeads?.(),
    mockConversationAdapter.listThreads()
  ]);
  const leads = leadPage?.items ?? [];
  const threads = [...threadPage.items].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  const selectedThread = threads.find((thread) => thread.id === selectedThreadParam) ?? threads[0];

  if (!selectedThread) {
    return (
      <div className="app-shell">
        <aside className="sidebar" />
        <main className="main">
          <section className="messenger-empty">
            <MessageSquare size={24} />
            <h1>대화 데이터가 없습니다</h1>
          </section>
        </main>
      </div>
    );
  }

  const selectedLead = getMockLeadById(selectedThread.leadId);
  const selectedChannel = getMockChannelById(selectedThread.channelId);
  const selectedQualification = getMockQualificationByLeadId(selectedThread.leadId);
  const messagePage = await mockConversationAdapter.listMessages({ threadId: selectedThread.id });
  const messages = messagePage.items;
  const gradeACount = mockQualifications.filter((qualification) => qualification.grade === "A").length;
  const openThreads = threads.filter((thread) => thread.status === "open").length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">Q</div>
          <div>
            <span className="brand-title">QualiFlow</span>
            <span className="brand-caption">Inbound sales inbox</span>
          </div>
        </div>

        <nav className="nav-section" aria-label="Workspace">
          <div className="nav-label">Workspace</div>
          <button className="nav-item active" type="button">
            <MessageSquare size={16} />
            <span>메신저</span>
          </button>
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1 className="page-title">메신저</h1>
            <p className="caption">채널별 inbound 문의를 같은 형태로 모아 보고, A 바이어를 우선 관리합니다.</p>
          </div>
          <span className="status-pill">Mock adapter connected</span>
        </header>

        <section className="workspace-summary" aria-label="Messenger summary">
          <div>
            <span>바이어</span>
            <strong>{leads.length}</strong>
          </div>
          <div>
            <span>A 바이어</span>
            <strong>{gradeACount}</strong>
          </div>
          <div>
            <span>열린 대화</span>
            <strong>{openThreads}</strong>
          </div>
        </section>

        <section className="messenger-layout" aria-label="Messenger workspace">
          <aside className="thread-panel">
            <div className="panel-toolbar">
              <div>
                <h2>대화</h2>
                <span>{threads.length} threads</span>
              </div>
              <button className="icon-button" type="button" aria-label="검색">
                <Search size={16} />
              </button>
            </div>

            <div className="thread-list">
              {threads.map((thread) => (
                <ThreadPreview key={thread.id} thread={thread} selected={thread.id === selectedThread.id} />
              ))}
            </div>
          </aside>

          <section className="conversation-panel">
            <div className="conversation-header">
              <div className="lead-heading">
                <div className="lead-avatar large">
                  <span>{getInitials(selectedLead)}</span>
                  <ChannelBadge channel={selectedChannel} />
                </div>
                <div>
                  <div className="eyebrow">{selectedChannel.label}</div>
                  <h2>{getLeadLabel(selectedLead)}</h2>
                  <p>
                    {selectedLead?.displayName ?? "Unknown contact"} · {selectedLead?.countryName ?? "Unknown country"}
                  </p>
                </div>
              </div>
              <span className={`grade grade-${selectedQualification?.grade.toLowerCase() ?? "unknown"}`}>
                {selectedQualification?.grade ?? "-"} buyer
              </span>
            </div>

            <div className="message-timeline">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </div>

            <div className="reply-draft">
              <div>
                <span>답변 초안</span>
                <p>{selectedQualification?.recommendedNextAction ?? "다음 액션을 확인한 뒤 답변을 작성합니다."}</p>
              </div>
              <button className="send-button" type="button">
                <Send size={16} />
                <span>초안 작성</span>
              </button>
            </div>
          </section>

          <aside className="context-panel">
            <section className="context-section">
              <div className="section-title">
                <ShieldCheck size={16} />
                <h2>분류 결과</h2>
              </div>
              <p className="qualification-summary">{selectedQualification?.summary ?? "분류 결과가 없습니다."}</p>
              <dl className="info-grid">
                <div>
                  <dt>확신도</dt>
                  <dd>{selectedQualification?.confidence ?? "-"}</dd>
                </div>
                <div>
                  <dt>평가자</dt>
                  <dd>{selectedQualification?.evaluatedBy ?? "-"}</dd>
                </div>
              </dl>
            </section>

            <section className="context-section">
              <div className="section-title">
                <CheckCircle2 size={16} />
                <h2>판정 근거</h2>
              </div>
              <ul className="plain-list">
                {(selectedQualification?.reasons ?? []).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </section>

            <section className="context-section">
              <div className="section-title">
                <Clock3 size={16} />
                <h2>부족한 증거</h2>
              </div>
              <ul className="plain-list muted">
                {(selectedQualification?.missingEvidence ?? []).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="context-section">
              <div className="section-title">
                <Globe2 size={16} />
                <h2>바이어 정보</h2>
              </div>
              <dl className="info-grid">
                <div>
                  <dt>회사</dt>
                  <dd>{selectedLead?.companyName ?? "-"}</dd>
                </div>
                <div>
                  <dt>국가</dt>
                  <dd>{selectedLead?.countryName ?? "-"}</dd>
                </div>
                <div>
                  <dt>이메일</dt>
                  <dd>{selectedLead?.primaryEmail ?? "-"}</dd>
                </div>
              </dl>
            </section>

            <section className="context-section">
              <div className="section-title">
                <Mail size={16} />
                <h2>채널</h2>
              </div>
              <div className="channel-stack">
                {(selectedLead?.sourceChannelIds ?? []).map((channelId) => {
                  const channel = getMockChannelById(channelId);

                  return (
                    <span className="channel-chip" key={channelId} style={getChannelStyle(channel)}>
                      <ChannelBadge channel={channel} />
                      {channel.label}
                    </span>
                  );
                })}
              </div>
            </section>
          </aside>
        </section>
      </main>
    </div>
  );
}
