"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

function getSafePath(value: string | null) {
  return value?.startsWith("/") ? value : "/";
}

function getPostAuthPath() {
  const currentUrl = new URL(window.location.href);

  if (currentUrl.pathname === "/login") {
    return getSafePath(currentUrl.searchParams.get("next"));
  }

  return `${currentUrl.pathname}${currentUrl.search}`;
}

export function AuthSessionHandler() {
  useEffect(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";

    if (!hash.includes("access_token=")) {
      return;
    }

    const hashParams = new URLSearchParams(hash);
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const sessionTokens =
      accessToken && refreshToken
        ? {
            accessToken,
            refreshToken
          }
        : null;

    let cancelled = false;

    async function completeHashSession() {
      if (!sessionTokens) {
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token: sessionTokens.accessToken,
        refresh_token: sessionTokens.refreshToken
      });

      if (cancelled || error) {
        return;
      }

      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      const postAuthPath = getPostAuthPath();
      window.history.replaceState(null, "", cleanUrl);
      window.location.replace(postAuthPath);
    }

    void completeHashSession();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
