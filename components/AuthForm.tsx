"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { SkyMark } from "./SkyMark";
import { ThemeToggle } from "./ThemeToggle";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const register = mode === "register";
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const name = String(form.get("name") || "").trim();
    if (register && !name) { setError("请输入用户名"); return; }
    if (register && password !== form.get("confirmPassword")) { setError("两次密码输入不一致"); return; }
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, ...(register ? { name } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (register ? "注册失败，请重试" : "登录失败，请重试"));
      const me = await fetch("/api/auth/me");
      if (!me.ok) throw new Error("登录状态验证失败，请重新登录");
      router.replace("/chat");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "网络错误，请重试"); }
    finally { pending.current = false; setLoading(false); }
  };
  return (
    <div className="sky-auth">
      <header className="sky-auth-header"><Link href="/" className="sky-auth-brand" aria-label="Sky Chat 首页"><SkyMark className="sky-brand-mark size-8" />Sky Chat</Link><ThemeToggle /></header>
      <main className="sky-auth-main">
        <div className="sky-auth-form">
          <h1 className="sky-auth-title">{register ? "从这里，开始对话。" : "欢迎回来。"}</h1>
          <p className="sky-auth-description">{register ? "创建账号，让问题与思路都有一个落点。" : "登录 Sky Chat，继续上一次的思路。"}</p>
          {error && <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-xs leading-5 text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{error}</p>}
          <form onSubmit={(event) => void submit(event)} className="sky-auth-fields">
            {register && <div><label htmlFor="name" className="sky-auth-label">怎么称呼你</label><input id="name" name="name" autoComplete="name" required maxLength={50} placeholder="你的名字" className="sky-auth-input" disabled={loading} /></div>}
            <div><label htmlFor="email" className="sky-auth-label">邮箱地址</label><input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" className="sky-auth-input" disabled={loading} /></div>
            <div><label htmlFor="password" className="sky-auth-label">密码</label><input id="password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 6 : undefined} placeholder={register ? "至少 6 位密码" : "输入你的密码"} className="sky-auth-input" disabled={loading} /></div>
            {register && <div><label htmlFor="confirmPassword" className="sky-auth-label">确认密码</label><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={6} placeholder="再输入一次密码" className="sky-auth-input" disabled={loading} /></div>}
            <button disabled={loading} className="sky-auth-submit">{loading ? <><LoaderCircle size={16} className="animate-spin" />{register ? "正在创建账号…" : "正在登录…"}</> : <>{register ? "创建账号" : "登录"}<ArrowRight size={15} /></>}</button>
          </form>
          <p className="sky-auth-switch">{register ? "已经有账号了？" : "还没有账号？"}<Link href={register ? "/login" : "/register"}>{register ? "直接登录" : "注册账号"}</Link></p>
        </div>
      </main>
      <footer className="pb-5 text-center"><Link href="/" className="sky-auth-back"><ArrowLeft size={14} />返回首页</Link></footer>
    </div>
  );
}
