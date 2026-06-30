import { Search } from "lucide-react";
import Link from "next/link";

import { formatShortDate, getLeadLabel, getMetadataText } from "./format";
import { LeadAvatar } from "./lead-avatar";
import type { InboxFilter, ThreadListItem } from "./types";

type ThreadListProps = {
  threads: ThreadListItem[];
  selectedThreadId: string;
  // 스레드를 눌러도 현재 필터/접힘 상태가 URL에서 사라지지 않도록 함께 들고 다닌다.
  activeFilter: InboxFilter;
  navCollapsed: boolean;
};

export function ThreadList({ threads, selectedThreadId, activeFilter, navCollapsed }: ThreadListProps) {
  return (
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
        {threads.map((item) => (
          <ThreadPreview
            key={item.thread.id}
            item={item}
            selected={item.thread.id === selectedThreadId}
            activeFilter={activeFilter}
            navCollapsed={navCollapsed}
          />
        ))}
      </div>
    </aside>
  );
}

function ThreadPreview({
  item,
  selected,
  activeFilter,
  navCollapsed
}: {
  item: ThreadListItem;
  selected: boolean;
  activeFilter: InboxFilter;
  navCollapsed: boolean;
}) {
  const { thread, lead, channel, qualification } = item;
  const nextAction = getMetadataText(thread.metadata?.nextAction, "다음 액션 확인 필요");
  const query: Record<string, string> = { thread: thread.id, filter: activeFilter };
  if (navCollapsed) {
    query.inbox = "collapsed";
  }

  return (
    <Link className={`thread-row ${selected ? "selected" : ""}`} href={{ pathname: "/", query }}>
      <LeadAvatar channel={channel} lead={lead} />
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
