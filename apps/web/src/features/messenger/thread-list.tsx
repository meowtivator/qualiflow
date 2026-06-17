import { Search } from "lucide-react";
import Link from "next/link";

import { ChannelBadge } from "./channel-badge";
import { formatShortDate, getInitials, getLeadLabel, getMetadataText } from "./format";
import type { ThreadListItem } from "./types";

type ThreadListProps = {
  threads: ThreadListItem[];
  selectedThreadId: string;
};

export function ThreadList({ threads, selectedThreadId }: ThreadListProps) {
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
          <ThreadPreview key={item.thread.id} item={item} selected={item.thread.id === selectedThreadId} />
        ))}
      </div>
    </aside>
  );
}

function ThreadPreview({ item, selected }: { item: ThreadListItem; selected: boolean }) {
  const { thread, lead, channel, qualification } = item;
  const nextAction = getMetadataText(thread.metadata?.nextAction, "다음 액션 확인 필요");

  return (
    <Link className={`thread-row ${selected ? "selected" : ""}`} href={{ pathname: "/", query: { thread: thread.id } }}>
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
