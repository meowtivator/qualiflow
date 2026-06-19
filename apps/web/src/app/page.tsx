import { MessageSquare, Settings } from "lucide-react";
import Link from "next/link";

import { ConnectorSettings } from "@/features/connectors/connector-settings";
import { MessengerWorkspace } from "@/features/messenger/messenger-workspace";
import { loadConversationSource } from "@/lib/conversation-source";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";

type HomePageProps = {
  searchParams?: Promise<{
    thread?: string | string[];
    view?: string | string[];
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

function AppSidebar({ currentView }: { currentView: "connectors" | "messenger" }) {
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
  const currentView = viewParam === "connectors" ? "connectors" : "messenger";

  if (currentView === "connectors") {
    return (
      <div className="app-shell">
        <AppSidebar currentView="connectors" />

        <main className="main scroll-main">
          <header className="topbar">
            <div>
              <h1 className="page-title">연동 설정</h1>
              <p className="caption">채널 계정 연결을 시작하고, runtime과 adapter 책임을 분리해 관리합니다.</p>
            </div>
            <div className="status-group">
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

          <ConnectorSettings />
        </main>
      </div>
    );
  }

  const selectedThreadParam = Array.isArray(params?.thread) ? params.thread[0] : params?.thread;
  const source = await loadConversationSource();
  const [leadPage, threadPage] = await Promise.all([
    source.adapter.listLeads?.(),
    source.adapter.listThreads()
  ]);
  const leads = leadPage?.items ?? [];
  const threads = [...threadPage.items].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  const selectedThread = threads.find((thread) => thread.id === selectedThreadParam) ?? threads[0];

  if (!selectedThread) {
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

  const selectedLead = source.getLead(selectedThread.leadId);
  const selectedChannel = source.getChannel(selectedThread.channelId);
  const selectedQualification = source.getQualification(selectedThread.leadId);
  const messagePage = await source.adapter.listMessages({ threadId: selectedThread.id });
  const messages = messagePage.items;
  const threadItems = threads.map((thread) => ({
    thread,
    lead: source.getLead(thread.leadId),
    channel: source.getChannel(thread.channelId),
    qualification: source.getQualification(thread.leadId)
  }));
  const selectedLeadChannels = (selectedLead?.sourceChannelIds ?? []).map((channelId) => source.getChannel(channelId));
  const gradeACount = source.gradeACount;
  const openThreads = threads.filter((thread) => thread.status === "open").length;

  return (
    <div className="app-shell">
      <AppSidebar currentView="messenger" />

      <main className="main messenger-main">
        <header className="topbar">
          <div>
            <h1 className="page-title">메신저</h1>
            <p className="caption">채널별 inbound 문의를 같은 형태로 모아 보고, A 바이어를 우선 관리합니다.</p>
          </div>
          <div className="status-group">
            <span className={`status-pill ${source.status.tone}`}>
              {source.status.label}
              <small>{source.status.detail}</small>
            </span>
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
