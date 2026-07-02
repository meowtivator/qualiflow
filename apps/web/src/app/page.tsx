import { Cpu, MessageSquare, Settings } from "lucide-react";
import Link from "next/link";

import { AgentConnector, type AgentRow } from "@/features/agents/agent-connector";
import { ConnectorSettings } from "@/features/connectors/connector-settings";
import { MessengerWorkspace } from "@/features/messenger/messenger-workspace";
import { InboxSidebar } from "@/features/messenger/inbox-sidebar";
import type { InboxFilter, InboxFilterOption } from "@/features/messenger/types";
import { loadConversationSource } from "@/lib/conversation-source";
import { loadConversationSourceFromDb } from "@/lib/supabase-conversation-source";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { ThemeToggle } from "./theme-toggle";

type HomePageProps = {
  searchParams?: Promise<{
    thread?: string | string[];
    view?: string | string[];
    filter?: string | string[];
    inbox?: string | string[];
  }>;
};

type RuntimeStatus = {
  label: string;
  detail?: string;
  tone: "ok" | "warning";
  showSignOut: boolean;
};

async function loadRuntimeStatus(): Promise<RuntimeStatus> {
  // 임시 데모 스위치: auth를 끄거나 비번 게이트를 쓰는 동안은 로그인/DB 확인을 건너뛰고 데모 배지만 보여준다.
  if (process.env.QUALIFLOW_DISABLE_AUTH === "1" || process.env.QUALIFLOW_DEMO_PASSWORD) {
    return {
      label: "Demo mode",
      detail: "로컬 연동 테스트",
      tone: "warning",
      showSignOut: false
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      label: "Mock adapter connected",
      detail: "Supabase env 없음",
      tone: "warning",
      showSignOut: false
    };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        label: "Supabase auth pending",
        detail: userError?.message ?? "로그인 필요",
        tone: "warning",
        showSignOut: false
      };
    }

    const { count: initialWorkspaceCount, error: initialWorkspaceError } = await supabase
      .from("workspaces")
      .select("id", { count: "exact", head: true });

    if (initialWorkspaceError) {
      throw initialWorkspaceError;
    }

    let workspaceCount = initialWorkspaceCount ?? 0;

    if (workspaceCount === 0) {
      const { error: createWorkspaceError } = await supabase.rpc("create_workspace", {
        workspace_name: "My QualiFlow Workspace"
      });

      if (createWorkspaceError) {
        throw createWorkspaceError;
      }

      const { count: refreshedWorkspaceCount, error: refreshedWorkspaceError } = await supabase
        .from("workspaces")
        .select("id", { count: "exact", head: true });

      if (refreshedWorkspaceError) {
        throw refreshedWorkspaceError;
      }

      workspaceCount = refreshedWorkspaceCount ?? 0;
    }

    return {
      label: "Supabase connected",
      detail: `${user.email ?? "authenticated"} · workspace ${workspaceCount}`,
      tone: "ok",
      showSignOut: true
    };
  } catch (error) {
    return {
      label: "Supabase check failed",
      detail: error instanceof Error ? error.message : "DB 연결 확인 실패",
      tone: "warning",
      showSignOut: true
    };
  }
}

// 세 뷰(연동/에이전트/메신저)가 같은 topbar를 복붙하지 않게 하나로 모은 헤더.
// extraPills: 메신저 뷰의 데이터소스 상태필처럼 runtime 필 앞에 끼울 추가 요소.
function Topbar({
  title,
  caption,
  runtimeStatus,
  extraPills
}: {
  title: string;
  caption: string;
  runtimeStatus: RuntimeStatus;
  extraPills?: React.ReactNode;
}) {
  return (
    <header className="topbar">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="caption">{caption}</p>
      </div>
      <div className="status-group">
        <ThemeToggle />
        {extraPills}
        <span className={`status-pill ${runtimeStatus.tone}`}>
          {runtimeStatus.label}
          {runtimeStatus.detail ? <small>{runtimeStatus.detail}</small> : null}
        </span>
        {runtimeStatus.showSignOut ? (
          <a className="status-link" href="/auth/sign-out">
            로그아웃
          </a>
        ) : null}
      </div>
    </header>
  );
}

function AppSidebar({ currentView }: { currentView: "connectors" | "messenger" | "agents" }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-main">
        <div className="brand">
          <div className="brand-mark">Q</div>
          <div>
            <span className="brand-title">QualiFlow</span>
            <span className="brand-caption">Inbound sales inbox</span>
          </div>
        </div>

        <nav className="nav-section" aria-label="Workspace">
          <div className="nav-label">Workspace</div>
          <Link className={`nav-item ${currentView === "messenger" ? "active" : ""}`} href="/">
            <MessageSquare size={16} />
            <span>메신저</span>
          </Link>
          <Link className={`nav-item ${currentView === "agents" ? "active" : ""}`} href="/?view=agents">
            <Cpu size={16} />
            <span>에이전트</span>
          </Link>
        </nav>
      </div>

      <nav className="sidebar-footer" aria-label="Settings">
        <Link className={`nav-item ${currentView === "connectors" ? "active" : ""}`} href="/?view=connectors">
          <Settings size={16} />
          <span>연동 설정</span>
        </Link>
      </nav>
    </aside>
  );
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const runtimeStatus = await loadRuntimeStatus();
  const viewParam = Array.isArray(params?.view) ? params.view[0] : params?.view;
  const currentView =
    viewParam === "connectors" ? "connectors" : viewParam === "agents" ? "agents" : "messenger";

  if (currentView === "connectors") {
    return (
      <div className="app-shell">
        <AppSidebar currentView="connectors" />

        <main className="main scroll-main">
          <Topbar
            title="연동 설정"
            caption="채널 계정 연결을 시작하고, runtime과 adapter 책임을 분리해 관리합니다."
            runtimeStatus={runtimeStatus}
          />

          <ConnectorSettings />
        </main>
      </div>
    );
  }

  if (currentView === "agents") {
    const devMode = process.env.NODE_ENV !== "production" && process.env.QUALIFLOW_DEV_SEED_LOGIN === "1";
    let isAuthed = false;
    let agents: AgentRow[] = [];

    if (isSupabaseConfigured()) {
      const supabase = await createServerSupabaseClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();
      isAuthed = Boolean(user);

      if (user) {
        const { data } = await supabase
          .from("agents")
          .select("id,label,platform,paired_at,last_seen_at,revoked_at,created_at")
          .order("created_at", { ascending: false });
        agents = (data as AgentRow[] | null) ?? [];
      }
    }

    return (
      <div className="app-shell">
        <AppSidebar currentView="agents" />

        <main className="main scroll-main">
          <Topbar
            title="에이전트"
            caption="로컬 에이전트를 페어링하고, 연결되어 저장된 에이전트를 확인합니다."
            runtimeStatus={runtimeStatus}
          />

          <AgentConnector agents={agents} devMode={devMode} isAuthed={isAuthed} />
        </main>
      </div>
    );
  }

  const selectedThreadParam = Array.isArray(params?.thread) ? params.thread[0] : params?.thread;
  const filterParam = Array.isArray(params?.filter) ? params.filter[0] : params?.filter;
  const inboxParam = Array.isArray(params?.inbox) ? params.inbox[0] : params?.inbox;
  const navCollapsed = inboxParam === "collapsed";
  // 로그인 사용자의 워크스페이스 DB를 우선 읽고(에이전트가 ingest로 채운 데이터), 없으면 .data/mock으로 폴백.
  const source = (await loadConversationSourceFromDb()) ?? (await loadConversationSource());
  const [leadPage, threadPage] = await Promise.all([
    source.adapter.listLeads?.(),
    source.adapter.listThreads()
  ]);
  const leads = leadPage?.items ?? [];
  const threads = [...threadPage.items].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));

  // 워크스페이스 합계(전체 데이터 기준 — 필터와 무관하게 항상 전체를 센다).
  const gradeACount = source.gradeACount;
  const openThreads = threads.filter((thread) => thread.status === "open").length;

  // 사이드바 폴더 = 전체 / 미답장 / (데이터에 실제 등장한)채널별. 채널은 하드코딩하지 않는다.
  //   "미답장" = 마지막 메시지가 inbound. 어댑터들이 그 규칙으로 thread.followUp을 채우므로 needs_my_reply로 판정.
  const unansweredThreads = threads.filter((thread) => thread.followUp === "needs_my_reply");
  const presentChannelIds: string[] = [];
  for (const thread of threads) {
    if (!presentChannelIds.includes(thread.channelId)) {
      presentChannelIds.push(thread.channelId);
    }
  }
  const channelOptions: InboxFilterOption[] = presentChannelIds
    .map((channelId) => {
      const channel = source.getChannel(channelId);
      return {
        filter: `channel:${channelId}` as InboxFilter,
        label: channel.label,
        count: threads.filter((thread) => thread.channelId === channelId).length,
        channel
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const filterOptions: InboxFilterOption[] = [
    { filter: "all", label: "전체", count: threads.length },
    { filter: "unanswered", label: "미답장", count: unansweredThreads.length },
    ...channelOptions
  ];

  // URL ?filter= 검증 — 실제 존재하는 폴더만 허용하고, 모르는 값은 "전체"로 폴백.
  const activeFilter: InboxFilter = filterOptions.some((option) => option.filter === filterParam)
    ? (filterParam as InboxFilter)
    : "all";

  // 활성 필터로 스레드 목록을 좁힌다(서버 사이드).
  const visibleThreads =
    activeFilter === "unanswered"
      ? unansweredThreads
      : activeFilter.startsWith("channel:")
        ? threads.filter((thread) => `channel:${thread.channelId}` === activeFilter)
        : threads;

  const selectedThread =
    visibleThreads.find((thread) => thread.id === selectedThreadParam) ?? visibleThreads[0];

  const topbar = (
    <Topbar
      title="메신저"
      caption="채널별 inbound 문의를 같은 형태로 모아 보고, A 바이어를 우선 관리합니다."
      runtimeStatus={runtimeStatus}
      extraPills={
        <span className={`status-pill ${source.status.tone}`}>
          {source.status.label}
          <small>{source.status.detail}</small>
        </span>
      }
    />
  );

  // 데이터가 아예 없음 → 기존 빈 상태(사이드바도 보여줄 게 없음).
  if (threads.length === 0) {
    return (
      <div className="app-shell">
        <AppSidebar currentView="messenger" />
        <main className="main messenger-main">
          <section className="messenger-empty">
            <MessageSquare size={24} />
            <h1>대화 데이터가 없습니다</h1>
          </section>
        </main>
      </div>
    );
  }

  // 데이터는 있는데 현재 필터 결과가 빈 경우(예: 미답장 0건) → 사이드바는 유지하고 안내만.
  if (!selectedThread) {
    return (
      <div className="app-shell">
        <AppSidebar currentView="messenger" />
        <main className="main messenger-main">
          {topbar}
          <section className={`messenger-layout filter-empty ${navCollapsed ? "nav-collapsed" : ""}`}>
            <InboxSidebar
              activeFilter={activeFilter}
              collapsed={navCollapsed}
              options={filterOptions}
              selectedThreadId={selectedThreadParam ?? ""}
            />
            <div className="messenger-empty inline">
              <MessageSquare size={24} />
              <h1>이 필터에 해당하는 대화가 없습니다</h1>
              <p className="caption">왼쪽에서 ‘전체’를 선택해 모든 대화를 볼 수 있습니다.</p>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const selectedLead = source.getLead(selectedThread.leadId);
  const selectedChannel = source.getChannel(selectedThread.channelId);
  const selectedQualification = source.getQualification(selectedThread.leadId);
  const messagePage = await source.adapter.listMessages({ threadId: selectedThread.id });
  const messages = messagePage.items;
  const threadItems = visibleThreads.map((thread) => ({
    thread,
    lead: source.getLead(thread.leadId),
    channel: source.getChannel(thread.channelId),
    qualification: source.getQualification(thread.leadId)
  }));
  const selectedLeadChannels = (selectedLead?.sourceChannelIds ?? []).map((channelId) => source.getChannel(channelId));

  return (
    <div className="app-shell">
      <AppSidebar currentView="messenger" />

      <main className="main messenger-main">
        {topbar}

        <MessengerWorkspace
          activeFilter={activeFilter}
          filterOptions={filterOptions}
          gradeACount={gradeACount}
          leadCount={leads.length}
          messages={messages}
          navCollapsed={navCollapsed}
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
