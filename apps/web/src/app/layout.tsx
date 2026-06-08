import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QualiFlow",
  description: "A B2B inbound sales inbox for lead qualification workflows"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
