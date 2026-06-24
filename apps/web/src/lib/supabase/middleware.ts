import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getSupabasePublicConfig } from "./config";

// /api/agents/pair, /api/agents/me, /api/agents/ingest 는 에이전트(로그인 세션 없음)가 호출하므로 공개.
// 보안은 세션이 아니라 페어링 코드(pair) 또는 Bearer 토큰 검증(me/ingest)이 책임진다 — 라우트가 자체 인증한다.
// (/api/agents/pairing-code 는 여기 없음 → 로그인 게이트 그대로 적용됨, 웹 사용자만 발급)
// /api/dev/login 은 로그인 전에 닿아야 하는 dev 전용 시드 로그인. 라우트 자체가 NODE_ENV/플래그로 이중 게이트됨.
const PUBLIC_PATHS = [
  "/healthz",
  "/login",
  "/auth/callback",
  "/auth/otp",
  "/api/agents/pair",
  "/api/agents/me",
  "/api/agents/ingest",
  "/api/agents/commands",
  "/api/dev/login"
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`));
}

// 임시 데모용 공유 비밀번호 게이트(HTTP Basic Auth) — Supabase auth를 잠깐 대체한다.
// 비밀번호는 코드/커밋이 아니라 환경변수 QUALIFLOW_DEMO_PASSWORD 에만 둔다.
function requireDemoPassword(request: NextRequest): NextResponse | null {
  const demoPassword = process.env.QUALIFLOW_DEMO_PASSWORD;
  if (!demoPassword) {
    return null; // 게이트 꺼짐 → 검사 안 함
  }

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice("Basic ".length));
    } catch {
      decoded = "";
    }
    // "아이디:비밀번호" 중 비밀번호만 확인한다(아이디는 아무거나 허용).
    const provided = decoded.slice(decoded.indexOf(":") + 1);
    if (provided === demoPassword) {
      return null; // 비번 일치 → 통과
    }
  }

  // 비번이 없거나 틀리면 브라우저 비밀번호 입력창을 띄운다(401).
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="QualiFlow demo", charset="UTF-8"' }
  });
}

export async function updateSession(request: NextRequest) {
  const isPublic = isPublicPath(request.nextUrl.pathname);

  // 1) 데모 비번 게이트가 켜져 있으면 무엇보다 먼저 검사. 틀리면 여기서 401로 끝낸다.
  const demoGate = isPublic ? null : requireDemoPassword(request);
  if (demoGate) {
    return demoGate;
  }

  const config = getSupabasePublicConfig();
  // 2) DISABLE_AUTH=1 이거나 데모 비번 게이트가 켜져 있으면 Supabase 로그인 게이트를 건너뛴다.
  const authDisabled = process.env.QUALIFLOW_DISABLE_AUTH === "1" || Boolean(process.env.QUALIFLOW_DEMO_PASSWORD);
  let response = NextResponse.next({ request });

  if (!config) {
    return response;
  }

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const nextUrl = request.nextUrl.clone();
  const currentPath = `${nextUrl.pathname}${nextUrl.search}`;

  // authDisabled가 true면 비로그인 사용자도 막지 않는다(데모 공개용).
  if (!authDisabled && !user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = `?next=${encodeURIComponent(currentPath)}`;
    return NextResponse.redirect(redirectUrl);
  }

  if (user && nextUrl.pathname === "/login") {
    const requestedNext = nextUrl.searchParams.get("next");
    const safeNext = requestedNext?.startsWith("/") ? requestedNext : "/";
    const redirectUrl = new URL(safeNext, request.url);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
