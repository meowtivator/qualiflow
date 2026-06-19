import type { Channel, Lead, LeadQualification, Message } from "@qualiflow/core";

import { ChannelBadge } from "./channel-badge";
import { getInitials, getLeadLabel } from "./format";
import { MessageTimeline } from "./message-timeline";
import { ReplyDraft } from "./reply-draft";

type ConversationPanelProps = {
  lead?: Lead;
  channel: Channel;
  qualification?: LeadQualification;
  messages: Message[];
};

export function ConversationPanel({ lead, channel, qualification, messages }: ConversationPanelProps) {
  const orderedMessages = [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  return (
    <section className="conversation-panel">
      <div className="conversation-header">
        <div className="lead-heading">
          <div className="lead-avatar large">
            <span>{getInitials(lead)}</span>
            <ChannelBadge channel={channel} />
          </div>
          <div>
            <div className="eyebrow">{channel.label}</div>
            <h2>{getLeadLabel(lead)}</h2>
            <p>
              {lead?.displayName ?? "Unknown contact"} · {lead?.countryName ?? "Unknown country"}
            </p>
          </div>
        </div>
        <span className={`grade grade-${qualification?.grade.toLowerCase() ?? "unknown"}`}>
          {qualification?.grade ?? "-"} buyer
        </span>
      </div>

      <MessageTimeline messages={orderedMessages} />

      <ReplyDraft
        channelLabel={channel.label}
        leadName={lead?.displayName ?? getLeadLabel(lead)}
        qualificationSummary={qualification?.summary}
        recommendedNextAction={qualification?.recommendedNextAction}
      />
    </section>
  );
}
