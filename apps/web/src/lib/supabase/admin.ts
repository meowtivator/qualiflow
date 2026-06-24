import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "./config";

// ⚠️ 서버 전용 admin(service-role) 클라이언트. RLS를 전부 우회하는 "만능 키"를 쓴다.
//    - 절대 클라이언트 컴포넌트로 import 금지(NEXT_PUBLIC 아님).
//    - 평상시 라우트에서 쓰지 말 것. 현재 유일 사용처는 dev 전용 시드 로그인(/api/dev/login)이며,
//      그 라우트는 NODE_ENV!=production + QUALIFLOW_DEV_SEED_LOGIN=1 로 이중 게이트돼 프로덕션에선 죽는다.
//    - 본 분산 설계에서 service-role 키는 웹 티어가 아니라 OCI 게이트웨이에 두는 게 원칙이다.
//      이 admin 클라이언트는 그 원칙의 "dev 예외"임을 분명히 한다.
export function createAdminClient() {
  const config = getSupabasePublicConfig();
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!config || !secret) {
    throw new Error("SUPABASE_SECRET_KEY and public Supabase config are required for the admin client.");
  }

  return createClient(config.url, secret, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }
  });
}
