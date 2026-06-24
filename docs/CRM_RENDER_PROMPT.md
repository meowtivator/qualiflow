# CRM 메신저 화면 — 병렬 세션 프롬프트

아래 블록을 buyer-crm(`github.com/thedozers/buyer-crm`, crm.thedozers.com) 클로드코드 세션에 그대로 붙여넣으세요.

---

```
당신은 buyer-crm (github.com/thedozers/buyer-crm, 배포 crm.thedozers.com) 작업 세션입니다.

[큰 그림]
QualiFlow(별도 레포/엔진)가 채널(alibaba·telegram·whatsapp·instagram)에서 메시지를 긁어
'같은 클라우드 Supabase'(프로젝트 ref tlcaxicyxkisevqeavcd)에 정규화해 저장한다.
당신의 일 = 그 데이터를 crm.thedozers.com 안에서 '메신저/인박스 화면'으로 새로 만들어 보여주는 것.
QualiFlow의 인박스 UI는 검증용 throwaway이므로 베끼지 말고, CRM 디자인에 맞춰 새로 구현한다.
표현(말풍선, 날짜 구분선, 채널 뱃지, 미디어 표시)은 전부 이 CRM 프론트의 몫이다.

[데이터 소스 — QualiFlow 소유 테이블. CRM은 SELECT만. 스키마/컬럼 변경 절대 금지]
leads(바이어 1명=1행):
  id, display_name, company_name, country_code, country_name, primary_email,
  profile_image_url, stage, sub_stage, source_channel_ids, metadata, created_at, updated_at
threads(대화방):
  id, lead_id, channel_id(alibaba|telegram|whatsapp|instagram), external_thread_id, title,
  status, priority, follow_up(needs_my_reply|waiting_on_customer|none),
  last_message_at, channel_identity_id, metadata, created_at, updated_at
messages(메시지):
  id, thread_id, lead_id, channel_id, external_message_id,
  direction(inbound|outbound), status, visibility,
  author(jsonb), content(jsonb: { "text": "..." }), attachments(jsonb 배열, 현재는 [] — 텍스트만),
  sent_at(ISO 타임스탬프), received_at, metadata, created_at
channel_connections(연결된 채널 계정):
  channel, account_label, status, last_synced_at, agent_id
channel_identities(lead의 채널별 외부 식별자):
  lead_id, channel, external_id, handle, display_name, profile_image_url

★주의:
 - 메시지 본문은 content.text (jsonb). 빈 텍스트/플레이스홀더가 있을 수 있다.
 - 날짜는 messages.sent_at (모든 메시지에 있음) → '날짜 바뀌면 날짜 구분선'은 sent_at로 그리면 됨.
 - 사진/영상은 아직 attachments가 비어 있음([]). 추후 QualiFlow가 채우면 그때 렌더(지금은 텍스트만).
 - 정확한 타입·제약은 QualiFlow 레포의 supabase/migrations(0001~0010)와
   apps/web/src/lib/supabase-conversation-source.ts(mapLead/mapThread/mapMessage)를 '정본 매핑'으로 참고.
   CRM은 이 DB→UI 매핑을 그대로 재현하면 된다(바퀴 재발명 금지).

[경계]
 - 위 6개 테이블은 QualiFlow 소유 → CRM은 읽기만. 변경이 필요하면 멈추고 보고.
 - CRM 자체 테이블(advertisers/buyers/interactions 등 drizzle)과는 별개. 링크가 필요하면
   buyers.lead_id 같은 'CRM 쪽' 컬럼으로 연결(QualiFlow 테이블은 안 건드림).
 - 인증: 납품 우선이라 지금은 Supabase auth 없이 바로 띄워도 됨. 단 service-role 키는
   '서버 사이드에서만'(route handler/server action) 쓰고 클라이언트로 새지 않게.

[화면 요구(1차)]
 - 좌측: 대화 목록 = threads, last_message_at desc. 행마다 lead 이름/회사, 채널 뱃지,
   follow_up 표시(내 답장 필요/고객 답 대기), 마지막 메시지 미리보기.
 - 우측: 선택한 thread의 messages 타임라인. inbound=좌/outbound=우 정렬, sent_at 표기,
   '날짜 바뀌면 날짜 구분선'.
 - 상단/사이드: 선택한 lead 프로필(display_name, company_name, country, stage).
 - 채널 필터(alibaba/telegram/whatsapp/instagram).

[배포] crm.thedozers.com 은 이미 oci-server VPS + Caddy로 200 응답 중. 같은 클라우드 DB를 읽으면 됨.

먼저 QualiFlow의 supabase/migrations 와 supabase-conversation-source.ts 를 읽고,
DB 스키마·매핑을 정리한 뒤 '구현 계획부터' 보고하라. 바로 코드 쓰지 말 것.
```

---

## 보조 메모(소유자용, CRM 세션엔 안 넣어도 됨)
- 클라우드 DB엔 현재 실데이터가 들어있음: leads 108 / threads 108 / messages ~3,416 / channel_connections 4(active).
- 같은 DB를 QualiFlow 인박스(qualiflow.thedozers.com, 무인증 데모)도 읽고 있어 대조 가능.
- `content.text`가 핵심 본문 필드. `attachments`는 미디어용 자리(현재 빈 배열).
