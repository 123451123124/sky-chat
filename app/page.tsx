import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/chat");
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-white dark:bg-gray-950 min-h-screen">
      <main className="flex flex-col items-center gap-8 py-16 px-8">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Sky Chat
          </h1>
          <p className="text-lg text-gray-500 max-w-md">
            AI 智能对话平台
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/login"
            className="px-6 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
          >
            登录
          </Link>
          <Link
            href="/register"
            className="px-6 py-2.5 bg-white text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
          >
            注册
          </Link>
        </div>
      </main>
    </div>
  );
}
