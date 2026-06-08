import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BuyerFlow",
  description: "A clean messenger-only lab for the Buyer CRM"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
