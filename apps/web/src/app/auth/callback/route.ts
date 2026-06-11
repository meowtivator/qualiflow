import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const safeNext = next?.startsWith("/") ? next : "/";

  if (!isSupabaseConfigured()) {
    const redirectUrl = new URL("/login", requestUrl.origin);
    redirectUrl.searchParams.set("error", "supabase_not_configured");
    return NextResponse.redirect(redirectUrl);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      const redirectUrl = new URL("/login", requestUrl.origin);
      redirectUrl.searchParams.set("next", safeNext);
      redirectUrl.searchParams.set("error", "auth_callback_failed");
      return NextResponse.redirect(redirectUrl);
    }
  }

  return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
}
