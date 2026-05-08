"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  _count: { sessions: number };
}

interface Session {
  id: string;
  title: string;
  userId: string | null;
  createdAt: string;
  _count: { messages: number };
}

interface Metric {
  id: string;
  type: string;
  name: string;
  value: number;
  url: string;
  sessionId: string | null;
  timestamp: string;
}

interface CurrentUser {
  userId: string;
  email: string;
  role: string;
}

interface AdminPageClientProps {
  currentUser: CurrentUser;
  users: User[];
  sessions: Session[];
  metrics: Metric[];
}

type TabType = "monitor" | "stall" | "users";

function getBaseMetricId(id: string): string {
  // Strip -ttlb or -stall suffix to get the base request ID
  return id.replace(/-(ttlb|stall)$/, '');
}

function getMetricLabel(type: string): string {
  switch (type) {
    case 'ttfb': return 'TTFB';
    case 'ttlb': return 'TTLB';
    case 'stall': return 'Stall';
    default: return type;
  }
}

export function AdminPageClient({ currentUser, users, sessions, metrics }: AdminPageClientProps) {
  const [activeTab, setActiveTab] = useState<TabType>("monitor");

  const ttfbMetrics = useMemo(() => metrics.filter((m) => m.type === "ttfb").slice(-100), [metrics]);
  const ttlbMetrics = useMemo(() => metrics.filter((m) => m.type === "ttlb").slice(-100), [metrics]);
  const stallMetrics = useMemo(() => metrics.filter((m) => m.type === "stall"), [metrics]);

  // Group metrics by base request ID for cross-referencing
  const groupedMetrics = useMemo(() => {
    const groups = new Map<string, { ttfb?: Metric; ttlb?: Metric; stall?: Metric }>();
    for (const m of metrics) {
      const baseId = getBaseMetricId(m.id);
      const existing = groups.get(baseId) || {};
      existing[m.type as 'ttfb' | 'ttlb' | 'stall'] = m;
      groups.set(baseId, existing);
    }
    return groups;
  }, [metrics]);

  const avgTtfb = ttfbMetrics.length > 0
    ? Math.round(ttfbMetrics.reduce((a, b) => a + b.value, 0) / ttfbMetrics.length)
    : 0;

  const avgTtlb = ttlbMetrics.length > 0
    ? Math.round(ttlbMetrics.reduce((a, b) => a + b.value, 0) / ttlbMetrics.length)
    : 0;

  const totalStalls = stallMetrics.length;
  const avgStallDuration = stallMetrics.length > 0
    ? Math.round(stallMetrics.reduce((a, b) => a + b.value, 0) / stallMetrics.length)
    : 0;

  const stallDistribution = useMemo(() => {
    const buckets = { '0-500ms': 0, '500-1000ms': 0, '1-3s': 0, '3-5s': 0, '5s+': 0 };
    stallMetrics.forEach((m) => {
      if (m.value < 500) buckets['0-500ms']++;
      else if (m.value < 1000) buckets['500-1000ms']++;
      else if (m.value < 3000) buckets['1-3s']++;
      else if (m.value < 5000) buckets['3-5s']++;
      else buckets['5s+']++;
    });
    return buckets;
  }, [stallMetrics]);

  const performanceChartOption = useMemo(() => {
    const timeLabels = ttfbMetrics.map((m) =>
      new Date(m.timestamp).toLocaleTimeString()
    );
    return {
      tooltip: { trigger: 'axis' as const },
      legend: { data: ['TTFB (ms)', 'TTLB (ms)'], textStyle: { color: '#9ca3af' } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category' as const, data: timeLabels, axisLabel: { color: '#9ca3af' } },
      yAxis: { type: 'value' as const, name: '耗时(ms)', nameTextStyle: { color: '#9ca3af' }, axisLabel: { color: '#9ca3af' } },
      series: [
        {
          name: 'TTFB (ms)',
          type: 'line' as const,
          data: ttfbMetrics.map((m) => Math.round(m.value)),
          smooth: true,
          itemStyle: { color: '#3b82f6' },
          areaStyle: { color: 'rgba(59,130,246,0.1)' },
        },
        {
          name: 'TTLB (ms)',
          type: 'line' as const,
          data: ttlbMetrics.map((m) => Math.round(m.value)),
          smooth: true,
          itemStyle: { color: '#10b981' },
          areaStyle: { color: 'rgba(16,185,129,0.1)' },
        },
      ],
    };
  }, [ttfbMetrics, ttlbMetrics]);

  const stallChartOption = useMemo(() => ({
    tooltip: { trigger: 'axis' as const },
    xAxis: {
      type: 'category' as const,
      data: Object.keys(stallDistribution),
      axisLabel: { color: '#9ca3af' },
    },
    yAxis: { type: 'value' as const, name: '次数', axisLabel: { color: '#9ca3af' }, nameTextStyle: { color: '#9ca3af' } },
    series: [
      {
        type: 'bar' as const,
        data: [
          { value: stallDistribution['0-500ms'], itemStyle: { color: '#10b981' } },
          { value: stallDistribution['500-1000ms'], itemStyle: { color: '#3b82f6' } },
          { value: stallDistribution['1-3s'], itemStyle: { color: '#f59e0b' } },
          { value: stallDistribution['3-5s'], itemStyle: { color: '#f97316' } },
          { value: stallDistribution['5s+'], itemStyle: { color: '#ef4444' } },
        ],
        barWidth: '50%',
      },
    ],
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
  }), [stallDistribution]);

  const stallTrendOption = useMemo(() => {
    const sorted = [...stallMetrics].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return {
      tooltip: { trigger: 'axis' as const },
      xAxis: {
        type: 'category' as const,
        data: sorted.map((m) => new Date(m.timestamp).toLocaleTimeString()),
        axisLabel: { color: '#9ca3af' },
      },
      yAxis: { type: 'value' as const, name: '卡顿时间(ms)', axisLabel: { color: '#9ca3af' }, nameTextStyle: { color: '#9ca3af' } },
      series: [
        {
          type: 'scatter' as const,
          data: sorted.map((m) => Math.round(m.value)),
          symbolSize: 8,
          itemStyle: { color: '#ef4444' },
        },
      ],
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    };
  }, [stallMetrics]);

  const sessionPieOption = useMemo(() => ({
    tooltip: { trigger: 'item' as const },
    series: [
      {
        type: 'pie' as const,
        radius: ['40%', '70%'],
        label: { color: '#9ca3af' },
        data: [
          {
            value: sessions.filter((s) => s._count.messages > 10).length,
            name: '长会话 (>10条)',
            itemStyle: { color: '#3b82f6' },
          },
          {
            value: sessions.filter((s) => s._count.messages > 0 && s._count.messages <= 10).length,
            name: '短会话 (1-10条)',
            itemStyle: { color: '#10b981' },
          },
          {
            value: sessions.filter((s) => s._count.messages === 0).length,
            name: '空会话',
            itemStyle: { color: '#6b7280' },
          },
        ],
      },
    ],
  }), [sessions]);

  const tabs: { key: TabType; label: string }[] = [
    { key: "monitor", label: "性能监控" },
    { key: "stall", label: "卡顿报告" },
    { key: "users", label: "用户管理" },
  ];

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">管理后台</h1>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <span className="text-sm text-gray-500 dark:text-gray-400">{currentUser.email}</span>
          <Link
            href="/chat"
            className="px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
          >
            返回聊天
          </Link>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
          >
            退出登录
          </button>
        </div>
      </header>

      <div className="flex gap-1 px-6 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <main className="p-6">
        {activeTab === "monitor" && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 text-center">
                <div className="text-3xl font-bold text-blue-500">{avgTtfb}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">平均 TTFB (ms)</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">首字节时间</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 text-center">
                <div className="text-3xl font-bold text-green-500">{avgTtlb}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">平均 TTLB (ms)</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">流式完成时间</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 text-center">
                <div className="text-3xl font-bold text-amber-500">{totalStalls}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">卡顿总次数</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">间隔 &gt;500ms</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 text-center">
                <div className="text-3xl font-bold text-red-500">{avgStallDuration}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">平均卡顿时长 (ms)</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">每次卡顿持续</div>
              </div>
            </div>

            {/* Performance Trend */}
            <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">SSE 性能趋势</h3>
              <ReactECharts option={performanceChartOption} style={{ height: 350 }} />
            </div>

            {/* Session Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">会话分布</h3>
                <ReactECharts option={sessionPieOption} style={{ height: 300 }} />
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">性能总览</h3>
                <div className="space-y-4 mt-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600 dark:text-gray-400">TTFB P50</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{avgTtfb} ms</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min(100, avgTtfb / 5)}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600 dark:text-gray-400">TTLB P50</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{avgTtlb} ms</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.min(100, avgTtlb / 10)}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "stall" && (
          <div className="space-y-6">
            {/* Stall Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 text-center">
                <div className="text-3xl font-bold text-red-500">{totalStalls}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">卡顿总次数</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">所有会话累计</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 text-center">
                <div className="text-3xl font-bold text-orange-500">{avgStallDuration}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">平均卡顿时长 (ms)</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">每次卡顿持续</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 text-center">
                <div className="text-3xl font-bold text-amber-500">{stallDistribution['5s+']}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">严重卡顿次数 (&gt;5s)</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">需要关注</div>
              </div>
            </div>

            {/* Stall Duration Distribution */}
            <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">卡顿时长分布</h3>
              <ReactECharts option={stallChartOption} style={{ height: 350 }} />
            </div>

            {/* Stall Scatter */}
            <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">卡顿散点图</h3>
              {stallMetrics.length > 0 ? (
                <ReactECharts option={stallTrendOption} style={{ height: 300 }} />
              ) : (
                <div className="h-[300px] flex items-center justify-center text-gray-400 dark:text-gray-500">暂无卡顿数据</div>
              )}
            </div>

            {/* Stall Detail Table with TTFB/TTLB */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">请求级指标详情</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">时间</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">TTFB (ms)</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">TTLB (ms)</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Stall 时长 (ms)</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">严重程度</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">页面</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {stallMetrics.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">暂无卡顿数据</td>
                      </tr>
                    )}
                    {[...stallMetrics].reverse().slice(0, 100).map((m) => {
                      const baseId = getBaseMetricId(m.id);
                      const group = groupedMetrics.get(baseId);
                      return (
                        <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {new Date(m.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="px-6 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                            {group?.ttfb ? `${Math.round(group.ttfb.value)}` : '-'}
                          </td>
                          <td className="px-6 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                            {group?.ttlb ? `${Math.round(group.ttlb.value)}` : '-'}
                          </td>
                          <td className="px-6 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                            {Math.round(m.value)}
                          </td>
                          <td className="px-6 py-3">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              m.value >= 5000
                                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                : m.value >= 1000
                                ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                                : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                            }`}>
                              {m.value >= 5000 ? '严重' : m.value >= 1000 ? '中等' : '轻微'}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-[200px] truncate">
                            {m.url}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* All Raw Metrics */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">原始指标数据</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">时间</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">类型</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">值</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">页面</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {[...metrics].reverse().slice(0, 100).map((m) => (
                      <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {new Date(m.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            m.type === 'ttfb'
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                              : m.type === 'ttlb'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>
                            {getMetricLabel(m.type)}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                          {Math.round(m.value)} ms
                        </td>
                        <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-[200px] truncate">
                          {m.url}
                        </td>
                      </tr>
                    ))}
                    {metrics.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">暂无指标数据</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "users" && (
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">邮箱</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">角色</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">会话数</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">注册时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{user.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{user.email}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        user.role === 'admin'
                          ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}>
                        {user.role === 'admin' ? '管理员' : '用户'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{user._count.sessions}</td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-400">暂无用户数据</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
