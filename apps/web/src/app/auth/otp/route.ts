import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getSupabasePublicConfig } from "@/lib/supabase/config";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OTP_MESSAGES: Record<string, string> = {
  email_required: "이메일을 입력해주세요.",
  email_invalid: "올바른 이메일 형식으로 입력해주세요.",
  otp_failed: "인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.",
  supabase_not_configured: "Supabase 환경변수가 설정되지 않았습니다."
};

function getSafeNextPath(value: FormDataEntryValue | null) {
  const nextPath = typeof value === "string" ? value : "/";
  return nextPath.startsWith("/") ? nextPath : "/";
}

function wantsJson(request: Request) {
  return request.headers.get("accept")?.includes("application/json") ?? false;
}

function buildLoginUrl(request: Request, nextPath: string, params: Record<string, string>) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", nextPath);

  Object.entries(params).forEach(([key, value]) => {
    loginUrl.searchParams.set(key, value);
  });

  return loginUrl;
}

function respondWithError(request: Request, nextPath: string, code: keyof typeof OTP_MESSAGES, status = 400) {
  const message = OTP_MESSAGES[code];

  if (wantsJson(request)) {
    return NextResponse.json({ ok: false, code, message }, { status });
  }

  return NextResponse.redirect(buildLoginUrl(request, nextPath, { error: code }), { status: 303 });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const nextPath = getSafeNextPath(formData.get("next"));
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email) {
    return respondWithError(request, nextPath, "email_required");
  }

  if (!EMAIL_PATTERN.test(email)) {
    return respondWithError(request, nextPath, "email_invalid");
  }

  const config = getSupabasePublicConfig();

  if (!config) {
    return respondWithError(request, nextPath, "supabase_not_configured", 500);
  }

  const requestUrl = new URL(request.url);
  const redirectTo = new URL("/auth/callback", requestUrl.origin);
  redirectTo.searchParams.set("next", nextPath);

  const supabase = createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo.toString(),
      shouldCreateUser: true
    }
  });

  if (error) {
    const message = error.message || OTP_MESSAGES.otp_failed;

    if (wantsJson(request)) {
      return NextResponse.json({ ok: false, code: "otp_failed", message }, { status: 400 });
    }

    return NextResponse.redirect(buildLoginUrl(request, nextPath, { error: "otp_failed" }), { status: 303 });
  }

  const message = "인증 메일을 보냈습니다. Mailpit에서 최신 메일 링크를 열어 인증을 완료하세요.";

  if (wantsJson(request)) {
    return NextResponse.json({ ok: true, message });
  }

  return NextResponse.redirect(buildLoginUrl(request, nextPath, { sent: "1" }), { status: 303 });
}
