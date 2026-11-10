import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../lib/prisma';
import { textSections } from '../lib/rag/chunking';
import { removeArtifacts, sectionsSchema } from '../lib/rag/pipeline/artifacts';
import { corpus } from '../tests/fixtures/retrieval-corpus';

// Recover only this test suite's content-addressed leftovers; never sweep arbitrary orphan user files.
const known=[...corpus.map((c)=>c.text),'# 报销流程\nREF-2026-07 的报销申请应在出差后 17 天内提交。附件上限为 8 MB。','# 私有细则\nPRIVATE-CANARY 不允许其他账号读取。REF-2026-07 的内部报销期限为 999 天。','# 企业附件\n企业版附件上限为 64 MB，支持多人审批。','修复格式标识后可以读取这份 UTF-8 文本，报销时限 17 天。','# 报销流程\nREF-2026-07 的报销申请调整为 23 天内提交。'];
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const canonical=(value:ReturnType<typeof sectionsSchema.parse>)=>JSON.stringify(value.map(({text,page,heading})=>({text,page,heading})));
async function main(){
 const root=path.resolve(process.env.RAG_STORAGE_DIR||'.data/rag');const project=path.resolve(process.cwd());
 if(!root.startsWith(project+path.sep))throw new Error('Fixture cleanup requires project-local storage');
 const rawHashes=new Set(known.map(hash));const parsedHashes=new Set(known.map((text)=>hash(canonical(textSections(text,true)))));
 const live=new Set((await prisma.document.findMany({select:{id:true}})).map((d)=>d.id));
 const liveGenerations=new Set((await prisma.ragGeneration.findMany({select:{id:true}})).map((g)=>g.id));
 let files=0,artifacts=0;
 for(const entry of await readdir(root,{withFileTypes:true})){
  if(!entry.isFile()||!/^[0-9a-f-]{36}$/i.test(entry.name)||live.has(entry.name))continue;
  const target=path.resolve(root,entry.name);if(path.dirname(target)!==root)throw new Error('Invalid cleanup target');
  const bytes=await readFile(target);if(rawHashes.has(hash(bytes))){await unlink(target);files++;}
 }
 const pipeline=path.join(root,'.pipeline');
 for(const entry of await readdir(pipeline,{withFileTypes:true}).catch(()=>[])){
  if(!entry.isDirectory()||!/^[0-9a-f-]{36}$/i.test(entry.name)||liveGenerations.has(entry.name))continue;
  const directory=path.resolve(pipeline,entry.name);if(path.dirname(directory)!==pipeline)throw new Error('Invalid artifact target');
  let verified=false;
  for(const name of await readdir(directory)){if(!/^parse-[0-9a-f-]{36}\.json$/i.test(name))continue;try{const sections=sectionsSchema.parse(JSON.parse(await readFile(path.join(directory,name),'utf8')));if(parsedHashes.has(hash(canonical(sections))))verified=true;}catch{}}
  if(verified){await prisma.ragIndexCleanup.upsert({where:{generationId:entry.name},create:{generationId:entry.name,availableAt:new Date(Date.now()+300000)},update:{}});await removeArtifacts(entry.name);artifacts++;}
 }
 console.log(JSON.stringify({fixtureFilesRemoved:files,fixtureArtifactDirectoriesRemoved:artifacts,liveDocumentsPreserved:live.size}));
}
void main().catch(()=>{console.error('Fixture cleanup stopped without sweeping unknown files');process.exitCode=1;}).finally(()=>prisma.$disconnect());
