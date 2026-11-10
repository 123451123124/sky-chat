import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink, rmdir, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

const directory = path.resolve('app/e2e-chat');
const fixture = path.join(directory, 'page.tsx');
try { await access(directory); throw new Error('Refusing to overwrite an existing app/e2e-chat directory'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(directory);
await writeFile(fixture, `import { notFound } from "next/navigation";
import { ChatPageClient } from "@/app/chat/ChatPageClient";
export default function TestChat() {
  if (process.env.NODE_ENV !== "development" || process.env.SKY_CHAT_E2E !== "1") notFound();
  return <ChatPageClient user={{userId:"test-user",email:"test@example.test",role:"user"}} initialSessions={[
    {id:"s1",title:"测试对话一",updatedAt:"2026-10-18T00:00:00Z",_count:{messages:2}},
    {id:"s2",title:"测试对话二",updatedAt:"2026-10-17T00:00:00Z",_count:{messages:2}}
  ]} />;
}`);
const adminDirectory = path.join(directory, 'manage');
const overviewDirectory = path.join(directory, 'admin');
const streamDirectory = path.join(directory, 'stream');
const ragDirectory = path.join(directory, 'rag');
await mkdir(ragDirectory); await mkdir(adminDirectory); await mkdir(overviewDirectory); await mkdir(streamDirectory);
await writeFile(path.join(adminDirectory, 'page.tsx'), `import { notFound } from "next/navigation";
import { KnowledgeManager } from "@/app/admin/knowledge/KnowledgeManager";
export default function TestManage() {
  if (process.env.NODE_ENV !== "development" || process.env.SKY_CHAT_E2E !== "1") notFound();
  return <KnowledgeManager user={{email:"admin@example.test"}} />;
}`);
await writeFile(path.join(ragDirectory, 'page.tsx'), `import { notFound } from "next/navigation";
import { RagWorkbench } from "@/app/admin/rag/RagWorkbench";
export default function TestRag() {
  if (process.env.NODE_ENV !== "development" || process.env.SKY_CHAT_E2E !== "1") notFound();
  return <RagWorkbench user={{email:"admin@example.test"}} />;
}`);
await writeFile(path.join(overviewDirectory, 'page.tsx'), `import { notFound } from "next/navigation";
import { AdminPageClient } from "@/app/admin/AdminPageClient";
export default function TestAdmin() {
  if (process.env.NODE_ENV !== "development" || process.env.SKY_CHAT_E2E !== "1") notFound();
  return <AdminPageClient currentUser={{userId:"test-admin",email:"admin@example.test",role:"admin"}} users={[{id:"demo",email:"user@example.test",name:"示例用户",role:"user",createdAt:"2026-10-19",_count:{sessions:3}}]} sessions={[]} metrics={[]} />;
}`);
await writeFile(path.join(streamDirectory, 'route.ts'), `export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development" || process.env.SKY_CHAT_E2E !== "1") return new Response(null, {status:404});
  const encoder = new TextEncoder();
  const body = new ReadableStream({ async start(controller) {
    const emit = (event: object) => controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\\n\\n'));
    try {
      emit({type:'text-start',id:'long'});
      for (let i=0;i<80;i++) {
        if (request.signal.aborted) return;
        emit({type:'text-delta',id:'long',delta:'### 第 '+i+' 段\\n\\n这是一段持续输出的测试回复，用于验证视口在文字换行、段落变化和内容增长时保持稳定。\\n\\n'});
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      emit({type:'text-end',id:'long'}); emit({type:'finish'}); controller.close();
    } catch { /* Client cancellation closes the fixture stream. */ }
  }});
  return new Response(body,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache'}});
}`);
let output = '';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3101'], {env:{...process.env,SKY_CHAT_E2E:'1',NEXT_TELEMETRY_DISABLED:'1'}, windowsHide:true});
server.stdout.on('data', (data) => { output += data; });
server.stderr.on('data', (data) => { output += data; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Test server exited: '+output);
    try { const response = await fetch('http://127.0.0.1:3101/e2e-chat'); if (response.ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  if (!ready) throw new Error('Test server did not become ready: '+output);
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath,['node_modules/@playwright/test/cli.js','test',...process.argv.slice(2)], {stdio:'inherit',windowsHide:true});
    child.on('exit', resolve);
  });
  process.exitCode = result ?? 1;
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (process.platform === 'win32') await new Promise((resolve) => { const kill = spawn('taskkill',['/pid',String(server.pid),'/t','/f'],{stdio:'ignore',windowsHide:true}); kill.on('exit',resolve); });
  else server.kill('SIGTERM');
  await unlink(fixture);
  for (const childDirectory of [adminDirectory, overviewDirectory, ragDirectory]) { await unlink(path.join(childDirectory, "page.tsx")); await rmdir(childDirectory); }
  await unlink(path.join(streamDirectory, "route.ts")); await rmdir(streamDirectory);
  await rmdir(directory);
  // The temporary route must not leave a stale import in generated dev types.
  await unlink(path.resolve(".next/dev/types/validator.ts")).catch((error) => { if (error.code !== "ENOENT") throw error; });
  if (process.exitCode) { await mkdir('test-results',{recursive:true}); await writeFile('test-results/server.log',output); }
}
