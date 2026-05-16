const SEARCH_API_KEY = process.env.SEARCH_API_KEY || "";
const SEARCH_API_URL = process.env.SEARCH_API_URL || "https://api.tavily.com/search";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export async function webSearch(query: string): Promise<{ results?: SearchResult[]; error?: string }> {
  if (!SEARCH_API_KEY) {
    return { error: "搜索功能未配置 API Key" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(SEARCH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SEARCH_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: 5,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { error: `搜索服务异常: ${response.status}` };
    }

    const data = await response.json();

    const results: SearchResult[] = (data.results || []).map(
      (r: { title?: string; url?: string; content?: string }) => ({
        title: r.title || "",
        url: r.url || "",
        content: r.content || "",
      })
    );

    return { results };
  } catch (e) {
    clearTimeout(timeoutId);
    console.error("Search failed:", e);
    return { error: "搜索服务请求失败" };
  }
}
