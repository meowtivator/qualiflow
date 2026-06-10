import { MessageSquare } from "lucide-react";

import {
  getMockChannelById,
  getMockLeadById,
  getMockQualificationByLeadId,
  mockConversationAdapter,
  mockQualifications
} from "@qualiflow/adapter-mock";

import { MessengerWorkspace } from "@/features/messenger/messenger-workspace";

type HomePageProps = {
  searchParams?: Promise<{
    thread?: string | string[];
  }>;
};

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
  const threadItems = threads.map((thread) => ({
    thread,
    lead: getMockLeadById(thread.leadId),
    channel: getMockChannelById(thread.channelId),
    qualification: getMockQualificationByLeadId(thread.leadId)
  }));
  const selectedLeadChannels = (selectedLead?.sourceChannelIds ?? []).map((channelId) => getMockChannelById(channelId));
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

        <MessengerWorkspace
          gradeACount={gradeACount}
          leadCount={leads.length}
          messages={messages}
          openThreadCount={openThreads}
          selectedChannel={selectedChannel}
          selectedLead={selectedLead}
          selectedLeadChannels={selectedLeadChannels}
          selectedQualification={selectedQualification}
          selectedThreadId={selectedThread.id}
          threads={threadItems}
        />
      </main>
    </div>
  );
}
