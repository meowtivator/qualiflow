# 바이어 데이터 강화 + 채널 통합 + 상세 고도화 설계

상태: **설계(2026-06-25)**. 구현 우선순위 **A → B → C**, D는 별개.
배경(정밀분석): 현재 데이터는 신호가 '이름'뿐(전화·이메일·회사·metadata 비어있고 whatsapp은 LID라 이름도 없음) → **채널-걸친 동일 바이어 신뢰 매칭 0건**. 자동 통합은 불가에 가깝고, 데이터부터 풍부하게 + 수동 통합 능력이 현실적.

## A. 알리바바 enrichment (★우선 — ③의 재료)
알리바바 raw에 `companyName`, `complianceCountryCode`(국가), `loginId`(handle), `profileImageUrl`가 존재하나 현재 (1)추출이 연락처 '행'의 이름/aliId만 긁고 (2)ingest DTO가 그 필드를 빼고 보내 → DB엔 company/country=null. (email/phone은 알리바바가 노출 안 함 → 불가.)
- **추출**(`packages/adapter-alibaba/src/cli/extract-session.ts`): 대화를 열었을 때의 바이어 패널/헤더에서 companyName·country를 best-effort로 읽어 `contact`에 채운다. (셀렉터는 라이브 검증 필요 — 못 읽으면 종전대로 null, 깨지진 않음.)
- **ingest DTO**(`packages/adapter-alibaba/src/normalize.ts` `alibabaToIngestConversations`): `contact`에 `companyName?, countryCode?, profileImageUrl?` 추가(handle=loginId 이미 있음).
- **ingest SDF**(신규 `supabase/migrations/0014_ingest_contact_profile.sql`): `ingest_conversations`가 contact의 company/country/profileImage를 받으면 leads(`company_name`,`country_code`,`profile_image_url`) + channel_identities(`display_name`,`profile_image_url`)에 채운다(있을 때만 갱신, 없으면 기존 유지). 멱등.
- 효과: 알리바바 바이어가 회사/국가/프로필사진을 갖게 됨 → ③ 상세가 풍부.

## B. ③ 바이어 상세 고도화 (CRM 표시 — A 위에서)
현재 메신저 우측 패널이 이름+등급 정도. 풍부하게:
- lead 프로필: display_name, **company_name, country(코드→국기/이름), primary_email(있으면), stage/sub_stage, profile_image**.
- **채널 배지**(이 바이어가 어느 채널들로 연락했는지 — 통합 후 여러 개), source_channel_ids.
- **대화 통계**: 총 메시지 수, 첫 연락/마지막 연락 시각, inbound/outbound 비율, 미디어 수.
- qualification(있으면 등급/요약/추천액션 — 현재 0행이라 비면 숨김).
- 파일: bpd `src/features/messenger/lead-panel.tsx` + `adapters.ts`(LeadProfileVM 확장) + queries(메시지 통계 집계).

## C. ② 채널 통합 (수동 병합 — 데이터 생기면 빛남)
"같은 바이어"를 사람이 묶고, 묶인 바이어는 채널탭 통합 인박스 + cross-channel 타임라인으로 본다.
- **데이터모델(★경계)**: QF leads는 CRM이 읽기전용 → **CRM 소유 테이블**에 병합 매핑을 둔다(QF 테이블 불변). 예: CRM Drizzle `buyer_links (canonical_lead_id, member_lead_id, created_by, created_at)`. CRM이 QF leads를 읽고 이 매핑으로 그룹핑. (대안: QF에 merged_into 컬럼 — 하지만 CRM이 QF에 못 써서 부적합.) ⚠️ CRM의 DATABASE_URL이 클라우드에 쓸 수 있는지 선검증 필요(현재 CRM 자체 테이블이 클라우드에 없음).
- **병합 UI**: 바이어 목록/상세에서 2명+ 선택 → "같은 바이어로 묶기" → buyer_links insert. 해제도 가능.
- **통합 인박스**: 한 (통합)바이어 클릭 → 그에 속한 모든 lead의 threads를 **상단 채널 탭**으로(alibaba/telegram/...). 탭 전환은 클라이언트 상태(메신저 고정뷰처럼).
- **cross-channel 타임라인**: 그 바이어의 모든 lead의 모든 메시지를 시간순 병합(현재 "어느 창구→어느 창구" 흐름이 보이게). 이미 `listMessagesByLead`가 lead별 전체를 주니, 통합바이어=여러 lead면 union.
- 지금 데이터엔 묶을 게 없어 1채널=1탭이지만, 구조가 1~N을 받게 만든다 → 실데이터/enrichment에서 자동으로 멀티탭.

## D. fetch 주기 자동화 (별개 — 옵션)
현재 수동. `daemon`(30분)이 있으나 로컬 fetch만(push 미연결) + 미상주. 진짜 주기엔 daemon에 push 추가 + 서비스 상주(launchd). ②③와 독립이라 분리 진행/후순위.

## 경계 스캔
- 공개계약(packages/core): 없음 예상(A는 ingest DTO/SDF, 기존 lead 컬럼 사용).
- DB 모양: A=ingest SDF 갱신(컬럼 신규 없음, 기존 leads 컬럼 채움) → 새 migration 0014. C=CRM 소유 `buyer_links` 신규(QF 불변).
- 시크릿/인증 경로: 없음(기존 ingest 경로 재사용).
- 비즈니스 판단: A="company/country 있으면 갱신, 없으면 유지". C="병합은 수동, CRM 소유 매핑".

## 검증
- A: 합성 ingest로 company/country가 leads에 저장되는지(SDF) + 알리바바 라이브 fetch로 실제 company/country가 찍히는지(추출).
- B: enriched 바이어가 CRM 상세에 회사/국가/통계로 뜨는지.
- C: 두 lead 병합 → 통합바이어 클릭 → 채널탭 2개 + 합쳐진 타임라인.

## 시퀀스
A(enrichment: DTO+SDF 먼저 검증 → 추출 best-effort) → B(③ 상세, A 위) → C(② 병합, 데이터모델 선검증) → (D 옵션).
