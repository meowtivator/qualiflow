import { Inbox, MailQuestion, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";

import { ChannelBadge } from "./channel-badge";
import type { InboxFilter, InboxFilterOption } from "./types";

type InboxSidebarProps = {
  options: InboxFilterOption[];
  activeFilter: InboxFilter;
  collapsed: boolean;
  // 현재 선택된 스레드 — 필터를 바꿔도 같은 스레드가 그 목록에 있으면 선택을 유지하려고 URL에 함께 싣는다.
  selectedThreadId: string;
};

// 필터를 바꾸는 링크의 href. 선택 스레드와 접힘 상태는 보존하고 filter만 교체한다.
function filterHref(filter: InboxFilter, selectedThreadId: string, collapsed: boolean) {
  const query: Record<string, string> = { filter, thread: selectedThreadId };
  if (collapsed) {
    query.inbox = "collapsed";
  }
  return { pathname: "/", query };
}

// 접힘 토글 링크의 href. filter와 선택 스레드는 보존하고 inbox(collapsed) 여부만 뒤집는다.
function collapseHref(activeFilter: InboxFilter, selectedThreadId: string, nextCollapsed: boolean) {
  const query: Record<string, string> = { filter: activeFilter, thread: selectedThreadId };
  if (nextCollapsed) {
    query.inbox = "collapsed";
  }
  return { pathname: "/", query };
}

function FolderIcon({ option }: { option: InboxFilterOption }) {
  if (option.channel) {
    return <ChannelBadge channel={option.channel} />;
  }
  if (option.filter === "unanswered") {
    return <MailQuestion size={16} />;
  }
  return <Inbox size={16} />;
}

export function InboxSidebar({ options, activeFilter, collapsed, selectedThreadId }: InboxSidebarProps) {
  return (
    <nav className={`inbox-sidebar ${collapsed ? "collapsed" : ""}`} aria-label="인박스 필터">
      <div className="inbox-sidebar-head">
        {collapsed ? null : <span className="inbox-sidebar-title">받은 대화</span>}
        <Link
          className="icon-button inbox-collapse"
          href={collapseHref(activeFilter, selectedThreadId, !collapsed)}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </Link>
      </div>

      <div className="inbox-folders">
        {options.map((option) => {
          const active = option.filter === activeFilter;
          return (
            <Link
              key={option.filter}
              className={`inbox-folder ${active ? "active" : ""}`}
              href={filterHref(option.filter, selectedThreadId, collapsed)}
              title={collapsed ? `${option.label} · ${option.count}` : undefined}
              aria-current={active ? "true" : undefined}
            >
              <span className="inbox-folder-icon">
                <FolderIcon option={option} />
              </span>
              {collapsed ? null : (
                <>
                  <span className="inbox-folder-label">{option.label}</span>
                  <span className="inbox-folder-count">{option.count}</span>
                </>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
