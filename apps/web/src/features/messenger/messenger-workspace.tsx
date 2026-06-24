import { ConversationPanel } from "./conversation-panel";
import { LeadContextPanel } from "./lead-context-panel";
import { ThreadList } from "./thread-list";
import type { MessengerWorkspaceProps } from "./types";

export function MessengerWorkspace({
  leadCount,
  gradeACount,
  openThreadCount,
  threads,
  selectedThreadId,
  selectedLead,
  selectedChannel,
  selectedQualification,
  selectedLeadChannels,
  messages
}: MessengerWorkspaceProps) {
  return (
    <>
      <section className="workspace-summary" aria-label="Messenger summary">
        <div>
          <span>바이어</span>
          <strong>{leadCount}</strong>
        </div>
        <div>
          <span>A 바이어</span>
          <strong>{gradeACount}</strong>
        </div>
        <div>
          <span>열린 대화</span>
          <strong>{openThreadCount}</strong>
        </div>
      </section>

      <section className="messenger-layout" aria-label="Messenger workspace">
        <ThreadList selectedThreadId={selectedThreadId} threads={threads} />
        <ConversationPanel
          channel={selectedChannel}
          lead={selectedLead}
          messages={messages}
          qualification={selectedQualification}
          selectedThreadId={selectedThreadId}
        />
        <LeadContextPanel channels={selectedLeadChannels} lead={selectedLead} qualification={selectedQualification} />
      </section>
    </>
  );
}
