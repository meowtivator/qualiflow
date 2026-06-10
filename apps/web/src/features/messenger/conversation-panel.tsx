import type { Channel, Lead, LeadQualification, Message } from "@qualiflow/core";

import { ChannelBadge } from "./channel-badge";
import { getInitials, getLeadLabel } from "./format";
import { MessageBubble } from "./message-bubble";
import { ReplyDraft } from "./reply-draft";

type ConversationPanelProps = {
  lead?: Lead;
  channel: Channel;
  qualification?: LeadQualification;
  messages: Message[];
};

export function ConversationPanel({ lead, channel, qualification, messages }: ConversationPanelProps) {
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

      <div className="message-timeline">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>

      <ReplyDraft
        channelLabel={channel.label}
        leadName={lead?.displayName ?? getLeadLabel(lead)}
        qualificationSummary={qualification?.summary}
        recommendedNextAction={qualification?.recommendedNextAction}
      />
    </section>
  );
}
