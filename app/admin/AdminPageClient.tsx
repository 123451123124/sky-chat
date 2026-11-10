"use client";

import { ManagementShell } from "./ManagementShell";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/components/ThemeProvider";

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
  userAgent: string;
  metadata: Record<string, unknown> | null;
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
  initialTab?: TabType;
}

type TabType = "overview" | "stall" | "users";

function getRequestId(m: Metric): string | null {
  const rid = (m.metadata as Record<string, unknown> | null)?._requestId as string | undefined;
  return rid || null;
}


function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return Math.round(sorted[Math.min(idx, sorted.length - 1)]);
}

type HealthLevel = 'good' | 'warning' | 'critical';

function healthColor(level: HealthLevel): string {
  switch (level) {
    case 'good': return '#10b981';
    case 'warning': return '#f59e0b';
    case 'critical': return '#ef4444';
  }
}

function healthLabel(level: HealthLevel): string {
  switch (level) {
    case 'good': return '良好';
    case 'warning': return '警告';
    case 'critical': return '严重';
  }
}

  function HealthCard({ label, value, unit, health, description }: {
    label: string; value: string; unit: string; health: HealthLevel; description: string;
  }) {
    return (
      <div className="sky-admin-section">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
          <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: healthColor(health) }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: healthColor(health) }} />
            {healthLabel(health)}
          </span>
        </div>
        <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {value}
          <span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-1">{unit}</span>
        </div>
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{description}</div>
      </div>
    );
  }

export function AdminPageClient({ currentUser, users, sessions, metrics, initialTab = "overview" }: AdminPageClientProps) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  const { theme: currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const theme = useMemo(() => ({
    textColor: isDark ? '#b3b3ca' : '#646477',
    borderColor: isDark ? '#3d3d50' : '#dddde9',
    tooltipBg: isDark ? '#23232f' : 'rgba(255,255,255,0.95)',
    tooltipBorder: isDark ? '#4b5563' : '#dddde9',
    axisLineColor: isDark ? '#3d3d50' : '#dddde9',
    splitLineColor: isDark ? '#303041' : '#f3f4f6',
  }), [isDark]);

  // ── Data ──
  const ttfbMetrics = useMemo(() => metrics.filter((m) => m.type === "ttfb").sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-100), [metrics]);
  const ttlbMetrics = useMemo(() => metrics.filter((m) => m.type === "ttlb").sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-100), [metrics]);
  const stallMetrics = useMemo(() => metrics.filter((m) => m.type === "stall"), [metrics]);
  const lcpMetrics = useMemo(() => metrics.filter((m) => m.type === "lcp").slice(-50), [metrics]);
  const clsMetrics = useMemo(() => metrics.filter((m) => m.type === "cls").slice(-50), [metrics]);

  // All TTFB/TTLB for stats (no limit)
  const allTtfb = useMemo(() => metrics.filter((m) => m.type === "ttfb"), [metrics]);
  const allTtlb = useMemo(() => metrics.filter((m) => m.type === "ttlb"), [metrics]);

  // Group by base request ID for cross-referencing
  const groupedMetrics = useMemo(() => {
    const groups = new Map<string, { ttfb?: Metric; ttlb?: Metric; stall?: Metric }>();
    for (const m of metrics) {
      const rid = getRequestId(m);
      if (!rid) continue;
      const existing = groups.get(rid) || {};
      existing[m.type as 'ttfb' | 'ttlb' | 'stall'] = m;
      groups.set(rid, existing);
    }
    return groups;
  }, [metrics]);

  // ── Health ──
  const sortedTtfb = useMemo(() => allTtfb.map((m) => m.value).sort((a, b) => a - b), [allTtfb]);
  const sortedTtlb = useMemo(() => allTtlb.map((m) => m.value).sort((a, b) => a - b), [allTtlb]);

  const currentTtfbP50 = percentile(sortedTtfb, 0.5);
  const currentTtlbP50 = percentile(sortedTtlb, 0.5);

  const ttfbHealth: HealthLevel = currentTtfbP50 < 200 ? 'good' : currentTtfbP50 < 500 ? 'warning' : 'critical';
  const ttlbHealth: HealthLevel = currentTtlbP50 < 1000 ? 'good' : currentTtlbP50 < 3000 ? 'warning' : 'critical';

  const totalRequests = allTtfb.length || allTtlb.length;
  const stallRate = totalRequests > 0 ? (stallMetrics.length / totalRequests) * 100 : 0;
  const stallRateHealth: HealthLevel = stallRate < 1 ? 'good' : stallRate < 5 ? 'warning' : 'critical';

  const overallHealth: HealthLevel = [ttfbHealth, ttlbHealth, stallRateHealth].includes('critical') ? 'critical'
    : [ttfbHealth, ttlbHealth, stallRateHealth].includes('warning') ? 'warning' : 'good';

  // ── Stats ──
  const ttfbP50 = percentile(sortedTtfb, 0.5);
  const ttfbP90 = percentile(sortedTtfb, 0.9);
  const ttfbP99 = percentile(sortedTtfb, 0.99);
  const ttlbP50 = percentile(sortedTtlb, 0.5);
  const ttlbP90 = percentile(sortedTtlb, 0.9);
  const ttlbP99 = percentile(sortedTtlb, 0.99);
  const requestCount = allTtfb.length || allTtlb.length;

  // ── Slow sessions ──
  const sessionPerformance = useMemo(() => {
    const map = new Map<string, { ttfb: number[]; ttlb: number[]; stallCount: number; count: number }>();
    for (const m of metrics) {
      if (!m.sessionId) continue;
      if (m.type !== 'ttfb' && m.type !== 'ttlb' && m.type !== 'stall') continue;
      let entry = map.get(m.sessionId);
      if (!entry) {
        entry = { ttfb: [], ttlb: [], stallCount: 0, count: 0 };
        map.set(m.sessionId, entry);
      }
      if (m.type === 'ttfb') { entry.ttfb.push(m.value); entry.count++; }
      if (m.type === 'ttlb') { entry.ttlb.push(m.value); }
      if (m.type === 'stall') { entry.stallCount++; }
    }
    return Array.from(map.entries())
      .map(([sessionId, data]) => ({
        sessionId: sessionId.slice(0, 8) + '...',
        fullSessionId: sessionId,
        avgTtfb: data.ttfb.length > 0 ? Math.round(data.ttfb.reduce((a, b) => a + b, 0) / data.ttfb.length) : 0,
        avgTtlb: data.ttlb.length > 0 ? Math.round(data.ttlb.reduce((a, b) => a + b, 0) / data.ttlb.length) : 0,
        stallCount: data.stallCount,
        requestCount: data.count,
      }))
      .sort((a, b) => b.avgTtlb - a.avgTtlb)
      .slice(0, 20);
  }, [metrics]);

  // ── ECharts options ──
  const performanceChartOption = useMemo(() => {
    const timeLabels = ttfbMetrics.map((m) => new Date(m.timestamp).toLocaleTimeString());
    return {
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        textStyle: { color: theme.textColor, fontSize: 12 },
        formatter: (params: unknown) => {
          const items = params as Array<{ seriesName: string; value: number; marker: string; dataIndex: number }>;
          if (!items?.length) return '';
          const idx = items[0].dataIndex;
          const m = ttfbMetrics[idx];
          const date = m ? new Date(m.timestamp).toLocaleString() : '';
          let html = `<div style="font-size:12px;color:${theme.textColor};margin-bottom:4px">${date}</div>`;
          items.forEach((item) => {
            html += `${item.marker} ${item.seriesName}: <strong>${item.value} ms</strong><br/>`;
          });
          return html;
        },
      },
      legend: {
        data: ['TTFB', 'TTLB'],
        textStyle: { color: theme.textColor },
        top: 0,
      },
      grid: { left: '3%', right: '4%', bottom: '20%', top: '18%', containLabel: false },
      xAxis: {
        type: 'category' as const,
        data: timeLabels,
        name: `最近 ${ttfbMetrics.length} 条请求（按时间）`,
        nameLocation: 'center' as const,
        nameGap: 40,
        nameTextStyle: { color: theme.textColor, fontSize: 11 },
        axisLine: { lineStyle: { color: theme.axisLineColor } },
        axisLabel: {
          color: theme.textColor,
          interval: Math.max(0, Math.floor(timeLabels.length / 8) - 1),
          rotate: timeLabels.length > 12 ? 45 : 0,
        },
      },
      yAxis: {
        type: 'value' as const,
        name: '耗时 (ms)',
        nameTextStyle: { color: theme.textColor },
        axisLabel: { color: theme.textColor },
        splitLine: { lineStyle: { color: theme.splitLineColor } },
      },
      series: [
        {
          name: 'TTFB',
          type: 'line' as const,
          data: ttfbMetrics.map((m) => Math.round(m.value)),
          smooth: true,
          symbol: 'circle',
          symbolSize: 4,
          lineStyle: { width: 2 },
          itemStyle: { color: '#7773d3' },
          areaStyle: { color: 'rgba(119,115,211,0.08)' },
        },
        {
          name: 'TTLB',
          type: 'line' as const,
          data: ttlbMetrics.map((m) => Math.round(m.value)),
          smooth: true,
          symbol: 'circle',
          symbolSize: 4,
          lineStyle: { width: 2 },
          itemStyle: { color: '#10b981' },
          areaStyle: { color: 'rgba(16,185,129,0.08)' },
        },
      ],
    };
  }, [ttfbMetrics, ttlbMetrics, theme]);

  const stallChartOption = useMemo(() => {
    const stallBuckets = { '0-500ms': 0, '500-1000ms': 0, '1-3s': 0, '3-5s': 0, '5s+': 0 };
    stallMetrics.forEach((m) => {
      if (m.value < 500) stallBuckets['0-500ms']++;
      else if (m.value < 1000) stallBuckets['500-1000ms']++;
      else if (m.value < 3000) stallBuckets['1-3s']++;
      else if (m.value < 5000) stallBuckets['3-5s']++;
      else stallBuckets['5s+']++;
    });
    return {
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        textStyle: { color: theme.textColor },
        formatter: (params: unknown) => {
          const items = params as Array<{ name: string; value: number; marker: string }>;
          if (!items?.length) return '';
          return `${items[0].name}<br/>次数: <strong>${items[0].value}</strong>`;
        },
      },
      xAxis: {
        type: 'category' as const,
        data: Object.keys(stallBuckets),
        axisLabel: { color: theme.textColor },
        axisLine: { lineStyle: { color: theme.axisLineColor } },
      },
      yAxis: {
        type: 'value' as const,
        name: '次数',
        axisLabel: { color: theme.textColor },
        nameTextStyle: { color: theme.textColor },
        splitLine: { lineStyle: { color: theme.splitLineColor } },
      },
      series: [
        {
          type: 'bar' as const,
          data: [
            { value: stallBuckets['0-500ms'], itemStyle: { color: '#10b981' } },
            { value: stallBuckets['500-1000ms'], itemStyle: { color: '#7773d3' } },
            { value: stallBuckets['1-3s'], itemStyle: { color: '#f59e0b' } },
            { value: stallBuckets['3-5s'], itemStyle: { color: '#f97316' } },
            { value: stallBuckets['5s+'], itemStyle: { color: '#ef4444' } },
          ],
          barWidth: '50%',
          itemStyle: { borderRadius: [4, 4, 0, 0] },
        },
      ],
      grid: { left: '3%', right: '4%', bottom: '6%', top: '6%', containLabel: true },
    };
  }, [stallMetrics, theme]);

  const stallTrendOption = useMemo(() => {
    const sorted = [...stallMetrics].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return {
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        textStyle: { color: theme.textColor },
        formatter: (params: unknown) => {
          const items = params as Array<{ dataIndex: number; value: number; marker: string; seriesName: string }>;
          if (!items?.length) return '';
          const idx = items[0].dataIndex;
          const m = sorted[idx];
          const rid = getRequestId(m);
          const group = rid ? groupedMetrics.get(rid) : undefined;
          return `<div>${new Date(m.timestamp).toLocaleString()}</div>`
            + `卡顿: <strong>${Math.round(m.value)} ms</strong><br/>`
            + `TTFB: ${group?.ttfb ? Math.round(group.ttfb.value) + ' ms' : '-'}<br/>`
            + `TTLB: ${group?.ttlb ? Math.round(group.ttlb.value) + ' ms' : '-'}`;
        },
      },
      xAxis: {
        type: 'category' as const,
        data: sorted.map((m) => new Date(m.timestamp).toLocaleTimeString()),
        axisLabel: { color: theme.textColor, interval: Math.max(0, Math.floor(sorted.length / 10) - 1) },
        axisLine: { lineStyle: { color: theme.axisLineColor } },
      },
      yAxis: {
        type: 'value' as const,
        name: '卡顿 (ms)',
        axisLabel: { color: theme.textColor },
        nameTextStyle: { color: theme.textColor },
        splitLine: { lineStyle: { color: theme.splitLineColor } },
      },
      series: [
        {
          type: 'scatter' as const,
          data: sorted.map((m) => Math.round(m.value)),
          symbolSize: (val: number) => Math.max(6, Math.min(16, val / 200)),
          itemStyle: { color: '#ef4444' },
        },
      ],
      grid: { left: '3%', right: '4%', bottom: '6%', top: '6%', containLabel: true },
    };
  }, [stallMetrics, theme, groupedMetrics]);

  const headings = { overview: ['运行概览', '查看会话、首字节响应与流式输出的运行情况。'], stall: ['流式性能', '从卡顿分布与请求记录中定位问题。'], users: ['账号与会话', '查看注册账号及会话使用情况。'] };
  return <ManagementShell user={currentUser} section={activeTab} onSection={setActiveTab}>
    <div className="sky-page-heading"><div><h1>{headings[activeTab][0]}</h1><p>{headings[activeTab][1]}</p></div><span className="sky-muted">{users.length} 个账号 · {sessions.length} 段最近会话</span></div>
    <div className="sky-admin-data">
        {activeTab === "overview" && (requestCount === 0 ? <div className="sky-library-empty"><h2>还没有性能采样</h2><p>完成一次聊天后，这里会显示真实的响应耗时与流式性能。<br />当前没有数据，暂不评估系统健康状态。</p></div> : <div className="space-y-6">

            {/* ── Row 1: System Health ── */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">系统健康</h2>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ backgroundColor: healthColor(overallHealth) + '20', color: healthColor(overallHealth) }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: healthColor(overallHealth) }} />
                  {overallHealth === 'good' ? '采样指标良好' : overallHealth === 'warning' ? '需要关注' : '需要立即处理'}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <HealthCard
                  label="TTFB P50"
                  value={String(currentTtfbP50)}
                  unit="ms"
                  health={ttfbHealth}
                  description="首字节延迟，反映网络/服务端响应速度。良好 &lt;200ms"
                />
                <HealthCard
                  label="TTLB P50"
                  value={String(currentTtlbP50)}
                  unit="ms"
                  health={ttlbHealth}
                  description="流式完成时间，反映整体响应速度。良好 &lt;1000ms"
                />
                <HealthCard
                  label="卡顿率"
                  value={stallRate.toFixed(1)}
                  unit="%"
                  health={stallRateHealth}
                  description={`${requestCount} 次请求中 ${stallMetrics.length} 次卡顿`}
                />
                <HealthCard
                  label="总请求量"
                  value={String(requestCount)}
                  unit="次"
                  health="good"
                  description="最近采样中的请求数量"
                />
              </div>
            </div>

            <section className="sky-admin-section"><h3 className="mb-4 font-semibold">延迟百分位统计</h3><div className="overflow-x-auto"><table className="sky-percentile-table"><thead><tr><th>指标</th><th>P50</th><th>P90</th><th>P99</th></tr></thead><tbody><tr><th>首字节 TTFB</th><td>{ttfbP50} ms</td><td>{ttfbP90} ms</td><td>{ttfbP99} ms</td></tr><tr><th>完整回复 TTLB</th><td>{ttlbP50} ms</td><td>{ttlbP90} ms</td><td>{ttlbP99} ms</td></tr></tbody></table></div></section>

            {/* ── Row 3: Performance Trend ── */}
            <div className="sky-admin-section">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">SSE 性能趋势</h3>
              <ReactECharts option={performanceChartOption} style={{ height: 350 }} />
            </div>

            {/* ── Row 4: Slow Sessions ── */}
            {sessionPerformance.length > 0 && (
              <div className="sky-admin-section is-table">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">响应最慢的会话</h3>
                  <span className="text-xs text-gray-400 dark:text-gray-500">按平均 TTLB 降序排列</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-800/50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">会话</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">请求次数</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">平均 TTFB</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">平均 TTLB</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">卡顿次数</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">状态</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {sessionPerformance.map((s) => {
                        const avgHealth: HealthLevel = s.avgTtlb < 1000 ? 'good' : s.avgTtlb < 3000 ? 'warning' : 'critical';
                        return (
                          <tr key={s.fullSessionId} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono" title={s.fullSessionId}>{s.sessionId}</td>
                            <td className="px-6 py-3 text-sm text-gray-900 dark:text-gray-100">{s.requestCount}</td>
                            <td className="px-6 py-3 text-sm text-gray-900 dark:text-gray-100">{s.avgTtfb} ms</td>
                            <td className="px-6 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                              <span className="flex items-center gap-2">
                                {s.avgTtlb} ms
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: healthColor(avgHealth) }} />
                              </span>
                            </td>
                            <td className="px-6 py-3 text-sm text-gray-900 dark:text-gray-100">
                              {s.stallCount > 0
                                ? <span className="text-red-500 font-medium">{s.stallCount}</span>
                                : <span className="text-gray-400">0</span>
                              }
                            </td>
                            <td className="px-6 py-3 text-sm">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                avgHealth === 'good' ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20' :
                                avgHealth === 'warning' ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' :
                                'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                              }`}>
                                {healthLabel(avgHealth)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Row 5: Web Vitals ── */}
            {(lcpMetrics.length > 0 || clsMetrics.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {lcpMetrics.length > 0 && (
                  <div className="sky-admin-section">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">LCP 最大内容绘制</h3>
                    <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3">
                      {Math.round(lcpMetrics.reduce((a, b) => a + b.value, 0) / lcpMetrics.length)}
                      <span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-1">ms</span>
                    </div>
                    <div className="space-y-1.5">
                      {lcpMetrics.slice(-10).reverse().map((m) => (
                        <div key={m.id} className="flex justify-between text-xs">
                          <span className="text-gray-400 dark:text-gray-500">{new Date(m.timestamp).toLocaleTimeString()}</span>
                          <span className="text-gray-700 dark:text-gray-300">{Math.round(m.value)} ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {clsMetrics.length > 0 && (
                  <div className="sky-admin-section">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">CLS 累计布局偏移</h3>
                    <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3">
                      {(clsMetrics.reduce((a, b) => a + b.value, 0) / clsMetrics.length).toFixed(3)}
                    </div>
                    <div className="space-y-1.5">
                      {clsMetrics.slice(-10).reverse().map((m) => (
                        <div key={m.id} className="flex justify-between text-xs">
                          <span className="text-gray-400 dark:text-gray-500">{new Date(m.timestamp).toLocaleTimeString()}</span>
                          <span className="text-gray-700 dark:text-gray-300">{m.value.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "stall" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="sky-admin-section text-center">
                <div className="text-3xl font-bold text-red-500">{stallMetrics.length}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">总卡顿次数</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">全部会话累计</div>
              </div>
              <div className="sky-admin-section text-center">
                <div className="text-3xl font-bold text-orange-500">
                  {stallMetrics.length > 0
                    ? Math.round(stallMetrics.reduce((a, b) => a + b.value, 0) / stallMetrics.length)
                    : 0}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">平均卡顿时长 (ms)</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">每次卡顿持续</div>
              </div>
              <div className="sky-admin-section text-center">
                <div className="text-3xl font-bold text-amber-500">{stallRate.toFixed(1)}%</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">卡顿率</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{requestCount} 请求中 {stallMetrics.length} 次卡顿</div>
              </div>
              <div className="sky-admin-section text-center">
                <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">{allTtfb.length || allTtlb.length}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">总请求数</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">监测周期内</div>
              </div>
            </div>

            <div className="sky-admin-section">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">卡顿时长分布</h3>
              <ReactECharts option={stallChartOption} style={{ height: 300 }} />
            </div>

            <div className="sky-admin-section">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">卡顿散点图</h3>
              {stallMetrics.length > 0 ? (
                <ReactECharts option={stallTrendOption} style={{ height: 300 }} />
              ) : (
                <div className="h-[300px] flex items-center justify-center text-gray-400 dark:text-gray-500">暂无卡顿数据</div>
              )}
            </div>

            <div className="sky-admin-section is-table">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">卡顿详情</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">时间</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">TTFB</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">TTLB</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">卡顿时长</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">程度</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">会话</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">页面</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {stallMetrics.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">暂无卡顿数据</td>
                      </tr>
                    )}
                    {[...stallMetrics].reverse().slice(0, 100).map((m) => {
                      const rid = getRequestId(m);
                      const group = rid ? groupedMetrics.get(rid) : undefined;
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
                            {Math.round(m.value)} ms
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
                          <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-[150px] truncate font-mono" title={m.sessionId || ''}>
                            {m.sessionId ? m.sessionId.slice(0, 8) + '...' : '-'}
                          </td>
                          <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={m.url}>
                            {m.url}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "users" && (
          <div className="sky-admin-section is-table">
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
    </div>
  </ManagementShell>;
}
