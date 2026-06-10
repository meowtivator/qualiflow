import { CheckCircle2, Clock3, Globe2, Mail, ShieldCheck } from "lucide-react";

import type { Channel, Lead, LeadQualification } from "@qualiflow/core";

import { ChannelBadge } from "./channel-badge";
import { getChannelStyle } from "./format";

type LeadContextPanelProps = {
  lead?: Lead;
  qualification?: LeadQualification;
  channels: Channel[];
};

export function LeadContextPanel({ lead, qualification, channels }: LeadContextPanelProps) {
  return (
    <aside className="context-panel">
      <section className="context-section">
        <div className="section-title">
          <ShieldCheck size={16} />
          <h2>분류 결과</h2>
        </div>
        <p className="qualification-summary">{qualification?.summary ?? "분류 결과가 없습니다."}</p>
        <dl className="info-grid">
          <div>
            <dt>확신도</dt>
            <dd>{qualification?.confidence ?? "-"}</dd>
          </div>
          <div>
            <dt>평가자</dt>
            <dd>{qualification?.evaluatedBy ?? "-"}</dd>
          </div>
        </dl>
      </section>

      <section className="context-section">
        <div className="section-title">
          <CheckCircle2 size={16} />
          <h2>판정 근거</h2>
        </div>
        <ul className="plain-list">
          {(qualification?.reasons ?? []).map((reason) => (
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
          {(qualification?.missingEvidence ?? []).map((item) => (
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
            <dd>{lead?.companyName ?? "-"}</dd>
          </div>
          <div>
            <dt>국가</dt>
            <dd>{lead?.countryName ?? "-"}</dd>
          </div>
          <div>
            <dt>이메일</dt>
            <dd>{lead?.primaryEmail ?? "-"}</dd>
          </div>
        </dl>
      </section>

      <section className="context-section">
        <div className="section-title">
          <Mail size={16} />
          <h2>채널</h2>
        </div>
        <div className="channel-stack">
          {channels.map((channel) => (
            <span className="channel-chip" key={channel.id} style={getChannelStyle(channel)}>
              <ChannelBadge channel={channel} />
              {channel.label}
            </span>
          ))}
        </div>
      </section>
    </aside>
  );
}
