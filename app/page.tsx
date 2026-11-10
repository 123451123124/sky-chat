import Link from "next/link";
import { ArrowRight, Code2, FileText, Globe2, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SkyMark } from "@/components/SkyMark";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function Home() {
  if (await getCurrentUser()) redirect("/chat");
  return (
    <div className="sky-home">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7 sm:px-10">
        <Link href="/" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight"><SkyMark className="size-9 text-teal-700" />Sky Chat<span className="-ml-2 text-teal-600">.</span></Link>
        <div className="flex items-center gap-4"><ThemeToggle /><Link href="/login" className="text-xs text-gray-500 hover:text-teal-700">登录</Link><Link href="/register" className="rounded-lg bg-teal-700 px-4 py-2.5 text-xs text-white hover:bg-teal-800">开始使用 <ArrowRight size={12} className="ml-2 inline" /></Link></div>
      </nav>
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-16 px-6 py-16 sm:px-10 lg:grid-cols-2 lg:py-24">
        <div>
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-teal-800/15 px-3 py-1.5 text-[11px] text-teal-700 dark:text-teal-400"><Sparkles size={12} />给好奇心，一个新的起点</div>
          <h1 className="text-5xl leading-[1.3] font-medium tracking-tight sm:text-6xl">想法，值得<br /><span className="text-teal-700 dark:text-teal-400">聊一聊。</span></h1>
          <p className="mt-6 max-w-sm text-sm leading-8 text-gray-500 dark:text-gray-400">从写下第一句话，到找到新的可能。<br />和 Sky Chat 一起写作、编程、探索，<br />让每一个想法，都有回响。</p>
          <div className="mt-9 flex flex-wrap items-center gap-5"><Link href="/register" className="inline-flex items-center gap-7 rounded-lg bg-teal-700 px-5 py-3.5 text-xs text-white hover:bg-teal-800">开启你的第一段对话 <ArrowRight size={16} /></Link><Link href="/preview" className="text-xs text-gray-500 hover:text-teal-700">先看看界面 ↗</Link></div>
          <div className="mt-12 flex gap-6 text-[11px] text-gray-400"><span><Globe2 size={13} className="mr-1.5 inline" />联网搜索</span><span><FileText size={13} className="mr-1.5 inline" />文件理解</span><span><Code2 size={13} className="mr-1.5 inline" />代码助手</span></div>
        </div>
        <div className="sky-home-example" aria-label="对话示例">
          <div className="mb-8 flex items-center justify-between border-b border-black/5 pb-5 dark:border-white/10"><span className="flex items-center gap-2 text-xs"><span className="size-1.5 rounded-full bg-teal-600" />灵感正在发生</span><span className="text-[10px] text-gray-400">对话示例</span></div>
          <p className="ml-auto max-w-64 rounded-2xl rounded-br-sm bg-[#edf1e9] px-5 py-4 text-xs leading-6 text-gray-600 dark:bg-teal-950 dark:text-gray-300">我有一个想法，但不知道从哪里开始。</p>
          <div className="mt-7 flex items-start gap-3"><SkyMark className="size-8 shrink-0 text-teal-700" /><div className="pt-1 text-xs leading-7"><p className="mb-3 font-medium">没关系，我们一起慢慢展开。</p><p className="text-gray-500 dark:text-gray-400">先不用想完整的计划。<br />告诉我，你最想解决的一个小问题是什么？<br />好的开始，往往就是一个好问题。</p></div></div>
          <div className="mt-10 flex items-center justify-between rounded-xl border border-black/10 px-4 py-4 text-xs text-gray-400 dark:border-white/10"><span>从一个问题开始…</span><span className="flex size-7 items-center justify-center rounded-lg bg-teal-700 text-white"><ArrowRight size={14} /></span></div>
        </div>
      </main>
      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-7 text-[10px] text-gray-400 sm:px-10"><span>Sky Chat · 为好奇心，留一点空间。</span><span>AI 也会有疏漏，重要信息请核实。</span></footer>
    </div>
  );
}
