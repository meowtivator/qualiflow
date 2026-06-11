import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getSupabasePublicConfig } from "./config";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/otp"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`));
}

export async function updateSession(request: NextRequest) {
  const config = getSupabasePublicConfig();
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

  if (!user && !isPublicPath(nextUrl.pathname)) {
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
