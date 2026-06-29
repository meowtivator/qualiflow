import type { Metadata } from "next";
import "./globals.css";

import { AuthSessionHandler } from "./auth-session-handler";

export const metadata: Metadata = {
  title: "QualiFlow",
  description: "A B2B inbound sales inbox for lead qualification workflows"
};

// ★깜빡임(FOUC) 방지: 첫 페인트 전에 저장된 테마 선택을 <html data-theme>에 박는다.
//   저장값이 "light"|"dark"면 그걸 적용(OS 설정을 이김), 없으면 속성을 안 달아 @media가 OS를 따른다.
//   여기서 끝내야 다크 사용자가 라이트 화면을 한 프레임도 보지 않는다(ThemeToggle은 mount 후라 늦음).
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("qualiflow-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AuthSessionHandler />
        {children}
      </body>
    </html>
  );
}
