import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";
import "./rag.css";
import "./management.css";
import "./rag-workbench.css";
import "highlight.js/styles/github.css";

export const metadata: Metadata = {
  title: "Sky Chat - AI 智能对话平台",
  description: "支持流式对话、文件知识库、可溯源检索与三维来源探索的 AI 聊天客户端",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
