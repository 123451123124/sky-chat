import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
async function main() {
const names = ['infiniflow/ragflow', 'onyx-dot-app/onyx', 'run-llama/llama_index', 'langchain-ai/langchainjs', 'pgvector/pgvector-python', 'sindresorhus/p-queue'];
const sources = await Promise.all(names.map(async (name) => {
  const response = await fetch(`https://api.github.com/repos/${name}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) {
    const {stdout} = await promisify(execFile)('git',['ls-remote',`https://github.com/${name}.git`,'HEAD'],{windowsHide:true,timeout:20000});
    return {name,url:`https://github.com/${name}`,sha:stdout.split(/\s/)[0],metadataStatus:response.status,note:'GitHub API metadata unavailable; commit pinned through git ls-remote. No star count asserted.'};
  }
  const repo = await response.json();
  const commits = await fetch(`https://api.github.com/repos/${name}/commits?per_page=1`); const data = commits.ok ? await commits.json() : [];
  return { name, url: repo.html_url, stars: repo.stargazers_count, license: repo.license?.spdx_id, sha: data[0]?.sha, pushedAt: repo.pushed_at };
}));
await mkdir('docs/research', { recursive: true });
await writeFile('docs/research/rag-sources.json', JSON.stringify({ fetchedAt: new Date().toISOString(), sources }, null, 2));
console.log(sources.map((s) => `${s.name}: ${'error' in s ? s.error : `${s.license} ${s.sha?.slice(0, 10)}`}`).join('\n'));

}
void main().catch((error) => { console.error(error.message); process.exitCode = 1; });
