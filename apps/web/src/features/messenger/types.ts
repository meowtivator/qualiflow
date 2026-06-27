import type { Channel, Lead, LeadQualification, Message, Thread } from "@qualiflow/core";

export type ThreadListItem = {
  thread: Thread;
  lead?: Lead;
  channel: Channel;
  qualification?: LeadQualification;
};

// 인박스 사이드바 필터. URL 쿼리 ?filter= 로 표현된다.
//   - "all": 전체 스레드
//   - "unanswered": 마지막 메시지가 inbound(=내가 답해야 함). thread.followUp === "needs_my_reply" 로 판정.
//   - `channel:<channelId>`: 그 채널의 스레드만. <channelId>는 데이터에 실제 등장한 채널만.
export type InboxFilter = "all" | "unanswered" | `channel:${string}`;

// 사이드바가 그릴 폴더 한 칸(라벨 + 현재 스레드 수). 채널 칸은 channel 필드를 함께 들고 온다.
export type InboxFilterOption = {
  filter: InboxFilter;
  label: string;
  count: number;
  channel?: Channel;
};

export type MessengerWorkspaceProps = {
  leadCount: number;
  gradeACount: number;
  openThreadCount: number;
  threads: ThreadListItem[];
  selectedThreadId: string;
  selectedLead?: Lead;
  selectedChannel: Channel;
  selectedQualification?: LeadQualification;
  selectedLeadChannels: Channel[];
  messages: Message[];
  // 인박스 사이드바(맨 왼쪽 폴더/필터) 상태. page.tsx(서버)에서 계산해 내려준다.
  filterOptions: InboxFilterOption[];
  activeFilter: InboxFilter;
  navCollapsed: boolean;
};
