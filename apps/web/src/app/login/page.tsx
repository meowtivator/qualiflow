import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/supabase/config";

import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string | string[];
    next?: string | string[];
    sent?: string | string[];
  }>;
};

const LOGIN_ERRORS: Record<string, string> = {
  auth_callback_failed: "인증 링크 처리에 실패했습니다. 새 인증 메일을 다시 요청해주세요.",
  email_invalid: "올바른 이메일 형식으로 입력해주세요.",
  email_required: "이메일을 입력해주세요.",
  otp_failed: "인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.",
  supabase_not_configured: "Supabase 환경변수가 설정되지 않았습니다."
};

const SENT_MESSAGE = "인증 메일을 보냈습니다. Mailpit에서 최신 메일 링크를 열어 인증을 완료하세요.";

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextParam = Array.isArray(params?.next) ? params.next[0] : params?.next;
  const errorParam = Array.isArray(params?.error) ? params.error[0] : params?.error;
  const sentParam = Array.isArray(params?.sent) ? params.sent[0] : params?.sent;
  const nextPath = nextParam && nextParam.startsWith("/") ? nextParam : "/";
  const initialError = errorParam ? LOGIN_ERRORS[errorParam] ?? "로그인 처리 중 오류가 발생했습니다." : undefined;
  const initialMessage = sentParam === "1" ? SENT_MESSAGE : undefined;
  const configured = isSupabaseConfigured();

  return (
    <main className="auth-page">
      <div className="auth-header">
        <Link className="brand-link" href="/">
          QualiFlow
        </Link>
        <span>Supabase local check</span>
      </div>

      {configured ? (
        <LoginForm initialError={initialError} initialMessage={initialMessage} nextPath={nextPath} />
      ) : (
        <section className="auth-card">
          <div>
            <h1>Supabase 환경변수가 필요합니다</h1>
            <p>
              로컬 DB/Auth를 붙이려면 `.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`과
              `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 설정해주세요.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
