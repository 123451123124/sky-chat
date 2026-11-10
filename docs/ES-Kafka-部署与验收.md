# TypeScript RAG：部署、迁移与验收

本轮业务数据库仍为 Supabase PostgreSQL。ES 承担全文和向量检索；Kafka 承担持久阶段消息。Web、权限、会话与 Agent 继续使用 Next.js / TypeScript / Prisma。原有 pgvector 代码留作迁移回滚路径。

## 当前运行方式

当前本机采用官方原生发行包：Elasticsearch 8.19.0、同版本 analysis-ik、Kafka 3.9.1（KRaft）。ES 监听 `127.0.0.1:19200`，Kafka 监听 `127.0.0.1:19092`，控制器为 19093。Web 为 `http://127.0.0.1:3100`。服务不是开机启动项。

Docker Compose 文件已提供，但本机 Docker Hub 拉取超时，因此此次真实验收使用原生服务，不能表述为已完成容器部署验收。归档校验见 `reports/rag-native-artifacts.json`；ES、Kafka 对照官方 SHA512，IK 下载器校验固定摘要和插件版本。

原生环境首次准备（Python 3.12+；Kafka 需 JDK 17，ES 使用自带 JDK）：

```powershell
python scripts/download-rag-native.py
python scripts/setup-rag-native.py
powershell -ExecutionPolicy Bypass -File scripts/start-rag-native.ps1
```

原生数据位于忽略的 `.data/services`；原始文件及阶段产物位于 `.data/rag`，Web 与 worker 必须使用相同的 `RAG_STORAGE_DIR`。多机器部署时必须换成共享对象存储/共享持久卷；当前本机文件存储不能直接横向扩展到无共享磁盘的机器。

本机 C 盘默认百分比水位导致主分片无法分配。经用户明确批准，仅本项目回环 ES 开发实例采用至少保留 **10/5/2 GB** 的低/高/紧急水位，仍保留磁盘保护。这是当前机器的开发配置，不是生产容量建议。不要将此配置复制到公网或生产集群。

容器方式（另选一种，避免端口冲突）：

```powershell
npm run rag:infra
npm run rag:infra:stop
```

Compose 绑定回环地址、单节点、单副本，持久卷保留。生产环境需要独立规划认证/TLS、副本、备份、容量、供应商配额和监控。

## 配置与启动

密钥只放本地 `.env` 或部署密钥管理器，示例见 `.env.example`。不要把已有文件替换成示例文件。

```dotenv
RAG_SEARCH_BACKEND="elasticsearch"
RAG_INGESTION_BACKEND="kafka"
ELASTICSEARCH_URL="http://127.0.0.1:19200"
ELASTICSEARCH_INDEX="sky-chat-chunks-v1"
KAFKA_BROKERS="127.0.0.1:19092"
KAFKA_TOPIC_PREFIX="sky-chat-rag-v1"
KAFKA_REPLICATION_FACTOR="1"
EMBEDDING_MODEL="text-embedding-v4"
EMBEDDING_CONCURRENCY="3"
EMBEDDING_BATCH_SIZE="10"
EMBEDDING_RPM="120"
```

```powershell
npm ci
npm run db:migrate
npm run rag:check:distributed
npm run rag:worker
# 另一个终端：
npm run build
npm start -- --hostname 127.0.0.1 --port 3100
```

`rag:worker` 根据当前配置选择 Kafka；`rag:kafka` 可明确启动同一分布式 worker。一个 worker 进程内运行四个阶段消费组及 Outbox relay；每阶段三分区、分区消费并发二。同一分区顺序处理，完成持久状态后手动提交 Offset。多进程扩容受三分区限制。

供应商 p-queue 是**单进程**限流：并发三、最多十条一批、RPM 120、查询优先、429 退避降并发，成功后逐步恢复。多个 worker 不共享全局令牌桶，应分摊配额。单文件最多同时提交配置数量的向量批次，避免把所有批次无限加入队列。

## 数据路径与一致性

上传 → 业务库事务写 Document / Generation / Outbox → Kafka parse → chunk → embed → index → ES refresh → 业务库切换 active generation。

- API 不等待解析或模型。Outbox 发布获 broker 全部副本确认后才标 sent；发送后崩溃可能重复投递，消费者必须幂等。
- 这是 at-least-once + 业务幂等，不宣传跨 PostgreSQL / Kafka / ES 的分布式 exactly-once。
- Stage 有租约、心跳、尝试次数；epoch 与 lease token 防止过期任务覆盖新任务。阶段文件按 token 命名，数据库仅指向获胜产物。
- 瞬时故障最多三次阶段重试，延迟保存在 Outbox。不可恢复或耗尽重试进入持久 DLQ，管理端可在草稿状态重放最新失败阶段。
- 解析检查点、成功向量批次分别保存；重放不重算已成功的前置阶段。
- ES Bulk 分批写入并逐项检查，只补偿可重试失败项；稳定 chunk ID 保持重复投递幂等。
- 删除先在业务库撤销可见性，再持久记录 ES/产物清理意图。延迟清理窗口覆盖在途阶段超时，避免晚到写入留下永久孤儿。
- 新 generation ready 前保留旧 active；历史分块不被重建删除，旧引用由当前文档族权限保护。
- 远程数据库交互事务默认 30 秒、等待 10 秒；切换/分块落库事务 45 秒。模型和文件工作放在事务外。瞬时连接、池等待、事务超时/冲突按可重试故障处理。

## 检索与权限

2048 维 `text-embedding-v4` → cosine float HNSW（m=16，ef_construction=100）；索引 IK max_word、查询 IK smart，自定义专业词典。BM25 标题/路径加权，编号 keyword 加权；BM25 路径进行窗口 phrase Rescore，再与 KNN 使用标准 RRF 融合，最后可选 qwen3-rerank。

ES 8.19 内置 RRF 与 Rescore 的组合受限，因此融合在 TypeScript 层完成。Rescore 是词项/短语阶段评分；外部神经重排是另一阶段，界面分别展示，避免混用概念。

权限事实来自业务库：库发布范围 ∩ 文件收窄权限 ∩ 当前版本 ∩ 会话选择 ∩ 标签。用户组闭包表支持父级授权覆盖子级成员。每次查询都计算允许的 active generation，分别放入 BM25 bool.filter 与 KNN 自身 filter；未授权片段不会进入候选文本和外部重排。重排和父块回填后再次复核当前权限与版本。ES 冗余 ACL 字段不是授权事实。

查询向量失败时混合检索可保留 BM25，模型重排失败时保留融合结果，并返回降级诊断；纯向量模式失败不会伪装成成功。

默认聊天使用混合+Rescore，模型重排由实验台显式选择。本轮小样本没有显示神经重排的额外收益，因此不在每轮聊天默认增加这次模型请求；真实业务语料有收益时再调整默认策略。

## 旧资料迁移与回滚

1. 应用增量迁移，保留账号、会话、原文件、旧 chunk ID 与旧 1024 维向量。
2. 启动 ES/IK、Kafka 和 worker，先跑隔离资料的真实检查。
3. `npm run rag:reindex` 为当前管理员资料创建 2048 维 generation；重复执行跳过已经就绪或处理中任务。
4. 核对原始 SHA256、旧分块、新叶块数量与 ES count。本机两份原有资料的核对在 `reports/rag-es-cutover.json`。
5. 所有当前资料新索引就绪后设置两个 backend 标志，重启 Web / worker。

回滚时先停止 Kafka worker，再显式设置 `RAG_SEARCH_BACKEND=postgres`、`RAG_INGESTION_BACKEND=database` 并重启。旧的两份资料保留了旧向量；**切换后新上传的 ES-only 文档没有旧 pgvector 向量，不能声称无条件回滚所有资料**。这些文档需先在旧路径重新索引；已发布库需先取消发布。不要清空数据库或删除持久卷。

## 可复现验证

```powershell
npm test
npm run test:e2e
npm run lint
npm run build
npm run rag:distributed:smoke
npm run rag:smoke
npx tsx scripts/rag-engine-smoke.ts
npx tsx scripts/rag-pipeline-ui-smoke.ts
npx tsx scripts/rag-runtime-state.ts
npm run rag:capacity
$env:EVAL_QUERY_CONCURRENCY='2'
npm run rag:evaluate
```

真实验证会创建明确命名的临时账号/虚构资料并调用已配置模型，结束后清理；不会使用真实资料作为评测语料。浏览器回归使用模拟接口，真实 Web smoke 另有独立报告。

检索评测比较 BM25、KNN、混合、混合+Rescore、混合+Rescore+模型重排。100 题来自八份虚构政策资料（42 既有问题 + 58 冻结补充），报告分组指标、每题结果、并行问题数与 P50/P95，进度写到 `reports/rag-evaluation-progress.json`。这是文档级检索评测，不能写成答案准确率或公开基准成绩。

容量脚本在独立临时索引建立一万条 2048 维确定性合成向量，以相同过滤范围的精确 cosine 搜索作为 ANN 召回参照，比较 num_candidates=50/200/1000。它不能证明业务语义质量或生产吞吐；完整结果包含固定查询顺序与预热影响说明。

当前验收范围及尚未覆盖的故障场景以 `reports/rag-distributed-implementation.md` 为准。
