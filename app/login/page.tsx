"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("请输入邮箱和密码");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "登录失败");
        return;
      }

      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        setError("登录状态验证失败，请重试");
        return;
      }

      router.push("/chat");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !loading) {
      handleLogin();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
      <div className="w-full max-w-sm px-6">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            Sky Chat
          </h1>
          <p className="mt-2 text-sm text-gray-500">登录你的账号</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              邮箱
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入邮箱"
              required
              className="h-10"
              autoComplete="email"
              onKeyDown={handleKeyDown}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              密码
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
              className="h-10"
              autoComplete="current-password"
              onKeyDown={handleKeyDown}
            />
          </div>

          <Button
            type="button"
            onClick={handleLogin}
            disabled={loading}
            className="w-full h-10 bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-gray-200 dark:text-gray-900 text-white cursor-pointer"
          >
            {loading ? "登录中..." : "登录"}
          </Button>

          <div className="text-center text-sm text-gray-500">
            还没有账号？{" "}
            <Link
              href="/register"
              className="text-gray-900 dark:text-gray-100 hover:underline font-medium"
            >
              注册
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
