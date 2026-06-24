// 알리바바 OneTalk 화면(React) 내부에서 뽑아낸 "날것(raw)" 데이터의 모양.
//
// 여기 적힌 형태는 알리바바가 우리에게 주는 데이터를 그대로 받아 적은 것일 뿐이다.
// 알리바바가 프론트엔드를 바꾸면 이 모양도 바뀔 수 있다 → 그래서 이 파일은
// "깨지기 쉬운 가정"이고, 변환 규칙(normalize.ts)과 일부러 분리해 둔다.

export type AlibabaRawParty = {
  targetId: string; // 보낸/받는 사람의 aliId (계정 고유번호)
  targetType?: string;
};

export type AlibabaRawMessage = {
  messageId: number;
  uuid?: string;
  conversationCode: string; // 예: "2500...-3500...#11011@icbu" — 대화(thread)를 가리키는 안정적 식별자
  content: string; // 텍스트 메시지면 평문 문자열
  sendTime: number; // epoch ms (1970년부터의 밀리초). 사람이 못 읽는 숫자 시간.
  sender: AlibabaRawParty;
  msgType?: number; // 관찰값: 101 = 텍스트
  type?: number; // 관찰값: 1 = 텍스트
  subType?: number;
  autoReply?: number; // 0 / 1 (자동응답이었는지)
  spamStatus?: number;
  loginId?: string; // 상대(바이어)의 loginId
};

export type AlibabaRawContact = {
  aliId?: string;
  loginId?: string;
  name?: string;
  companyName?: string;
  complianceCountryCode?: string; // 예: "KR"
  profileImageUrl?: string;
};

// "고객 활동" 패널(지난 90일)의 지표.
// ⚠️ 이건 메시지(itemData)와 다른 출처다 — 별도 원격 모듈(customerBehaviorData)이
//    JSONP(queryCustomerInfo)로 받아온다. 그래서 메시지 추출과 따로 캡처해야 한다.
//    아래 키 이름은 화면 라벨에서 따온 잠정 이름이고, 실제 JSONP 응답 키는
//    추출기(Playwright/CDP)로 그 응답을 직접 캡처할 때 확정한다.
export type AlibabaBuyerActivity = {
  productViews?: number; // 제품 보기
  validInquiries?: number; // 유효한 문의
  validRfqs?: number; // 유효한 RFQ
  loginDays?: number | null; // 로그인 일수 (화면상 "--" 가능)
  spamInquiries?: number; // 스팸 문의
  blacklistCount?: number; // 블랙리스트
  totalTrades?: number; // 총 거래
  totalTradeAmountUsd?: number; // 총 거래량(USD)
  disputeCount?: number; // 이의 제기 수
};

// 메시지 패널 상단의 카드/주문 카운트(React props의 chatData). 영문 키는 실제 관찰값.
export type AlibabaBuyerOrderCounts = {
  productCardNum: number;
  inquiryCardNum: number;
  quotationCardNum: number;
  unPayOrderNum: number;
  unshippedOrderNum: number;
  unConfirmShipmentOrderNum: number;
};

// 한 대화를 통째로 뽑았을 때의 묶음.
// owner = 나(셀러), contact = 상대(바이어), messages = 그 대화의 메시지들.
export type AlibabaRawConversation = {
  owner: { aliId: string; name?: string };
  contact: AlibabaRawContact;
  messages: AlibabaRawMessage[];
  activity?: AlibabaBuyerActivity; // "고객 활동" 패널(선택) — 위 출처 주의
  orderCounts?: AlibabaBuyerOrderCounts; // 카드/주문 카운트(선택)
};
