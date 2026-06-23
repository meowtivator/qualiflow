// POST /api/dev/login — ★dev 전용 시드 로그인. 검증을 빠르게 하려고 OTP 없이 세션을 만든다.
//
// ⚠️ 이중 게이트: NODE_ENV!=production 이고 QUALIFLOW_DEV_SEED_LOGIN=1 일 때만 동작. 그 외엔 404.
//    프로덕션 빌드에선 이 경로가 죽어 있으므로 인증을 약화시키지 않는다.
//    내부적으로 admin(service-role) 키를 쓰지만(dev 예외), 게이트 밖에선 절대 실행되지 않는다.

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const DEV_EMAIL = "dev@qualiflow.local";
const DEV_PASSWORD = "dev-seed-login";

function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.QUALIFLOW_DEV_SEED_LOGIN === "1";
}

export async function POST() {
  if (!devLoginEnabled()) {
    return NextResponse.json({ ok: false, message: "Not found." }, { status: 404 });
  }

  // 1) admin으로 dev 사용자 보장(이미 있으면 에러 → 무시).
  try {
    const admin = createAdminClient();
    await admin.auth.admin
      .createUser({ email: DEV_EMAIL, password: DEV_PASSWORD, email_confirm: true })
      .catch(() => undefined);
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "admin client unavailable" },
      { status: 500 }
    );
  }

  // 2) SSR(anon + 쿠키) 클라이언트로 로그인 → 세션 쿠키 설정.
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  // 3) 워크스페이스 보장(페어링 코드 발급은 워크스페이스가 있어야 함).
  const { count } = await supabase.from("workspaces").select("id", { count: "exact", head: true });
  if (!count) {
    await supabase.rpc("create_workspace", { workspace_name: "Dev Workspace" });
  }

  return NextResponse.json({ ok: true });
}
