"use client";

// 헤더 다크모드 토글.
//   - 저장값(localStorage "qualiflow-theme")이 "light"|"dark"면 그걸 우선(OS 설정을 이김).
//   - 저장값이 없으면 "system" → OS의 prefers-color-scheme 를 따른다.
//   - 적용은 <html data-theme="..."> 로만 한다(없으면 globals.css의 @media가 OS를 따름).
// ★깜빡임(FOUC) 방지를 위한 '첫 페인트 전' 적용은 layout.tsx의 인라인 스크립트가 담당한다(여기 아님).
//
// 저장값을 React state로 복사하지 않고 useSyncExternalStore로 '바깥 상태(localStorage)'를 직접 읽는다.
//   → hydration mismatch 없이(서버 스냅샷="system"), effect-setState 없이 lint도 깨끗하게 동작.

import { Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "qualiflow-theme";
// 토글 순환 순서: 시스템 → 라이트 → 다크 → 시스템.
const ORDER: ThemeChoice[] = ["system", "light", "dark"];

function readStoredChoice(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") {
      return value;
    }
  } catch {
    // localStorage 접근 불가(프라이빗 모드 등) → 시스템 기본으로 처리.
  }
  return "system";
}

// 선택값을 실제 DOM에 반영: light|dark는 data-theme 지정, system은 속성 제거(=@media가 OS를 따름).
function applyChoice(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

function persistChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, choice);
    }
  } catch {
    // 저장 실패는 무시(이번 세션에는 적용되지만 다음 로드엔 시스템 기본).
  }
}

// ── useSyncExternalStore 배선: localStorage를 '외부 store'로 구독한다.
//    다른 탭에서 바꾸면 storage 이벤트로 이 탭도 아이콘이 갱신된다.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

const LABELS: Record<ThemeChoice, string> = {
  system: "테마: 시스템 설정 따름",
  light: "테마: 라이트",
  dark: "테마: 다크"
};

export function ThemeToggle() {
  // 클라이언트 스냅샷=실제 저장값, 서버 스냅샷="system"(첫 HTML과 일치 → mismatch 없음).
  const choice = useSyncExternalStore<ThemeChoice>(subscribe, readStoredChoice, () => "system");

  const cycle = useCallback(() => {
    const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
    applyChoice(next);
    persistChoice(next);
    notify();
  }, [choice]);

  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;

  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      onClick={cycle}
      aria-label={LABELS[choice]}
      title={LABELS[choice]}
    >
      <Icon size={16} />
    </button>
  );
}
