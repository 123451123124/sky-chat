# Sky Chat：Java RAG 开源复用选型

核对日期：2026-10-20。本文是重构选型，尚未集成上游代码或迁移运行中的数据库。

目标技术栈：Java / Spring Boot / Spring Security JWT / MySQL / Elasticsearch（IK、BM25、HNSW KNN、Rescore）/ Kafka / WebSocket。保留 Sky Chat 的 Next.js 前端和通用知识工作台。

## 结论

采用“成熟框架直接依赖 + 已核实的业务模块源码适配 + Sky Chat 数据/接口适配”的组合，避免重新实现整套 Agent、PDF 解析、Kafka 重试、ES 批量客户端及 RRF。此轮没有选出一套已经本机验证、完全同栈且能直接替换现有后端的完整应用；下面的项目也不能宣称已通过本机运行验收。

推荐顺序：

1. **Spring AI Alibaba**：优先作为 Agent 和模型能力底座，以依赖方式复用，不复制重写其 Agent 主循环。
2. **Ragent**：优先抽取适配检索后处理、分块和入库节点等业务逻辑；其底层 Milvus/RocketMQ/鉴权不可直接带入目标方案。
3. **芋道 ruoyi-vue-pro**：成熟 Java/MySQL 管理业务与数据权限候选。选 Java 17 分支，按模块耦合决定采用范围，不整套引入无关业务。
4. **Spring Kafka、Elasticsearch Java Client、Tika/PDFBox**：直接依赖这些成熟组件完成基础能力。

Stars 为当次 GitHub 页面约数，只反映关注度；成熟度判断还依据源码、测试目录、模块划分与版本适配。固定提交与源码 SHA256 记录在 [研究快照](research/java-rag-candidates.json)。

## 1. Ragent：业务逻辑最值得抽取的候选

- 项目：[nageoffer/ragent](https://github.com/nageoffer/ragent)，约 4.3k Stars，根许可证 Apache-2.0。
- 核对提交：`ff93871ab88fff24a5dac7feee7ea342359a3439`。
- 已读取：POM、许可证、RRF 处理器、多路检索引擎、入库引擎、分块服务和消息消费者；目录包含对应测试，但本次没有运行这些测试。

| 已核实源码 | 实际作用 | 计划复用方式 |
| --- | --- | --- |
| [FusionPostProcessor](https://github.com/nageoffer/ragent/blob/ff93871ab88fff24a5dac7feee7ea342359a3439/rag/src/main/java/com/nageoffer/ai/ragent/rag/core/retrieval/postprocessor/FusionPostProcessor.java) | 各通道排名的加权 RRF、候选预算截断、通道归因 | 保留许可头并适配领域对象，接入 ES 的 BM25/Rescore 和 KNN 两个通道；不再从头写一套融合器 |
| [MultiChannelRetrievalEngine](https://github.com/nageoffer/ragent/blob/ff93871ab88fff24a5dac7feee7ea342359a3439/rag/src/main/java/com/nageoffer/ai/ragent/rag/core/retrieval/MultiChannelRetrievalEngine.java) | 检索通道组织与后处理链 | 提取接口和处理链，替换底层通道，不同时引入图谱和联网搜索 |
| [IngestionEngine](https://github.com/nageoffer/ragent/blob/ff93871ab88fff24a5dac7feee7ea342359a3439/rag/src/main/java/com/nageoffer/ai/ragent/ingestion/engine/IngestionEngine.java) | 入库节点组织、配置校验、节点结果与日志 | 复用节点/结果模型与执行逻辑；外层持久阶段调度接 Spring Kafka，检查点与幂等需要目标系统补齐 |
| [ChunkingService](https://github.com/nageoffer/ragent/blob/ff93871ab88fff24a5dac7feee7ea342359a3439/rag/src/main/java/com/nageoffer/ai/ragent/core/chunk/ChunkingService.java) | 分块服务契约 | 结合其按标题、段落、表格等块类型分派的模块，适配现有父子块及来源结构；先评估相关依赖再移植 |

必须处理的差异：当前固定提交 POM 使用 Spring Boot **4.1.0**、Milvus、RocketMQ、Sa-Token 和 AgentScope。它不是“Spring Boot 3.5 + ES + Kafka + Spring Security”的现成底座；不能把早期 README/派生仓库的技术栈当成当前版本。

因此不整包依赖 Ragent：抽取业务逻辑，使用目标系统的 ES、Kafka、JWT 与 Spring AI Agent 适配，防止出现两套模型框架和鉴权。

## 2. Spring AI Alibaba：优先直接依赖的 Agent 底座

- 项目：[alibaba/spring-ai-alibaba](https://github.com/alibaba/spring-ai-alibaba)，约 11k Stars。
- 核对提交：`17e26ff6fe951d605771c1845229ca3edb043634`；该 POM 的 Spring Boot 属性为 3.5.8。实际实施选兼容发布版并锁 BOM，不默认将主分支直接用于生产。
- 根许可证为 Apache-2.0，附带其引用的 MIT 等上游声明；按实际使用模块保留相关声明。

已核实：

- [ReactAgent](https://github.com/alibaba/spring-ai-alibaba/blob/17e26ff6fe951d605771c1845229ca3edb043634/spring-ai-alibaba-agent-framework/src/main/java/com/alibaba/cloud/ai/graph/agent/ReactAgent.java)：实际 Java Agent 实现，可作为工具循环框架，而不只参考文档手写一个循环。
- [KnowledgeBaseDocumentRetriever](https://github.com/alibaba/spring-ai-alibaba/blob/17e26ff6fe951d605771c1845229ca3edb043634/spring-ai-alibaba-admin/spring-ai-alibaba-admin-server-core/src/main/java/com/alibaba/cloud/ai/studio/core/rag/retriever/KnowledgeBaseDocumentRetriever.java)：存在多知识库并行检索、过滤和可选 DashScope 重排流程。
- [ElasticsearchVectorStore](https://github.com/alibaba/spring-ai-alibaba/blob/17e26ff6fe951d605771c1845229ca3edb043634/spring-ai-alibaba-admin/spring-ai-alibaba-admin-server-core/src/main/java/org/springframework/ai/vectorstore/elasticsearch/ElasticsearchVectorStore.java)：存在 ES 写入、向量/混合检索及过滤适配代码。
- admin 目录存在 MySQL schema 和部署配置；可以研究知识库生命周期，但不把整套 Studio 作为 Sky Chat 必需运行依赖。

采用边界：Agent、模型和标准工具接口优先直接依赖；ES 检索适配需明确实现目标方案的 IK/BM25/Rescore/KNN、当前版本和资源 ACL，不能把框架的通用 metadata filter 当成已完成文件权限。自定义工具继续负责 Sky Chat 的授权、引用、预算及审计。

## 3. 芋道：管理业务和权限模块备选

- 项目：[YunaiV/ruoyi-vue-pro](https://github.com/YunaiV/ruoyi-vue-pro)，约 39.9k Stars，根许可证 MIT。
- Java 17 / Spring Boot 3.5 对应 **master-jdk17** 分支，本次核对提交为 `7c397bbfae3e768b26e3ee962c5aa7064e8d7c96`。
- 默认 master 是 Java 8 / Spring Boot 2.7；本次先检视 master 后又核对了 Java 17 分支，不能直接复制 javax.servlet 代码到新后端。

候选模块：

- [AiKnowledgeDocumentServiceImpl](https://github.com/YunaiV/ruoyi-vue-pro/tree/master-jdk17/yudao-module-ai/src/main/java/cn/iocoder/yudao/module/ai/service/knowledge)：文档批量创建、状态更新、分块触发及删除流程。
- [AiKnowledgeSegmentServiceImpl](https://github.com/YunaiV/ruoyi-vue-pro/blob/7c397bbfae3e768b26e3ee962c5aa7064e8d7c96/yudao-module-ai/src/main/java/cn/iocoder/yudao/module/ai/service/knowledge/AiKnowledgeSegmentServiceImpl.java)：分块策略、向量写入、检索和重建流程，适合作为管理能力适配候选。
- [数据权限规则模块](https://github.com/YunaiV/ruoyi-vue-pro/tree/master-jdk17/yudao-framework/yudao-spring-boot-starter-biz-data-permission)：SQL 数据范围规则与部门范围组织。此逻辑不自动作用于 ES，仍需转换为检索过滤条件。

其框架认证过滤器通过 OAuth2 Token API 校验 Token，不能直接称为目标系统的 JWT 实现；若采用相关代码，应保留标准 Spring Security JWT 校验并适配现有 Cookie/账号。现有 Sky Chat 使用字符串 ID，上游大量实体使用 Long，也需要明确适配。

这是可选业务模块来源，不与 Ragent、Spring AI 各自的实体、身份和 Agent 体系整套拼接。整项目迁移会引入大量与 Sky Chat 无关的业务，首选按领域模块抽取。

## 4. 技术栈很像、但不选作主要底座的结果

### PaiSmart 公开仓库

[jinzhiwei0604/PaiSmart](https://github.com/jinzhiwei0604/PaiSmart) 的 README 列出了 Spring Boot、MySQL、ES、Kafka、Spring Security、WebSocket，技术栈与目标非常接近。但本次查到页面仅有 1 次提交、0 Stars，维护与使用证据不足；不能仅凭“企业级”描述就认定成熟，也未在本机验收。因此不把它作为主代码来源。

### 其他排除项

- [texican/RAG](https://github.com/texican/RAG)：README 明确将 Kafka 列为 future implementation；不能拿架构图当已实现的异步入库。
- [RAGFlow](https://github.com/infiniflow/ragflow)：可以继续对照产品和检索设计，但不是目标 Java 技术栈，不作为本次 Java 主底座。

## 5. 最终复用清单

| 能力 | 优先复用来源 | 方式 | Sky Chat 需要适配/补充 |
| --- | --- | --- | --- |
| ReAct / 工具循环 | Spring AI Alibaba Agent Framework | Maven 依赖 | 资料权限、工具白名单、预算、事件与来源映射 |
| 模型、向量、重排客户端 | 匹配版本的 Spring AI / 阿里云 SDK | Maven 依赖与适配器 | 2048 维、账号配置、限流/重试、配额统计 |
| 结构解析 | Apache Tika / PDFBox | Maven 依赖 | 页码/标题保留、上传校验、来源结构 |
| 分块、入库节点与结果模型 | Ragent 相关模块 | 按许可抽取适配 | 父子关联、Kafka 阶段边界、检查点 |
| RRF / 后处理链 | Ragent FusionPostProcessor 等 | 按许可抽取适配 | 对接 ES 两路候选、强制过滤、父块回填 |
| 知识管理、数据范围 | 芋道 AI/数据权限模块 | 选择性抽取，作为备选 | 现有字符串 ID、文件级 ACL、版本家族和接口契约 |
| Kafka 消费/退避/DLQ | Spring Kafka | Maven 依赖 | Outbox、业务幂等、阶段状态、DLQ 管理与重放规则 |
| ES 查询与批量写入 | 官方 Elasticsearch Java API Client / BulkIngester | Maven 依赖 | IK mapping、Rescore、HNSW 参数、部分失败与版本切换 |

参考：[Spring Kafka 的 DeadLetterPublishingRecoverer](https://docs.spring.io/spring-kafka/reference/kafka/annotation-error-handling.html)、[ES BulkIngester](https://www.elastic.co/docs/reference/elasticsearch/clients/java/usage/indexing-bulk)。

开发流程：先验证兼容版本并跑上游相关测试，再确定实际抽取文件；在独立包中适配，保留许可证、上游提交、修改记录和必要 NOTICE。之后用 Sky Chat 的权限、引用、版本、故障和检索评测验收。只在通过后把候选标为已复用。

当前只完成研究与方案更新：上游浅层仓库和选定文件已在临时目录用于只读检查；没有执行其构建脚本、替换现有应用或迁移数据库。
