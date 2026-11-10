# RAG component attribution

- `@elastic/elasticsearch` 8.19.1 — Apache-2.0. Official Elasticsearch JavaScript/TypeScript client, directly used for BM25, HNSW KNN, bulk indexing and health checks. License: `node_modules/@elastic/elasticsearch/LICENSE`. Source: https://github.com/elastic/elasticsearch-js
- `kafkajs` 2.2.4 — MIT, Copyright Túlio Ornelas. Directly used for Kafka producers, consumers, topic administration and offset monitoring. License: `node_modules/kafkajs/LICENSE`. Source: https://github.com/tulios/kafkajs
- Native development runtimes are downloaded separately: Elasticsearch 8.19.0 (upstream distribution license), Apache Kafka 3.9.1 (Apache-2.0), and analysis-ik 8.19.0 ([Apache-2.0 upstream license](https://github.com/infinilabs/analysis-ik/blob/master/LICENSE.txt)). Licenses shipped with the original distributions remain unchanged under the ignored `.data/services/runtime` directory. Runtime versions and verified archive hashes are recorded in `reports/rag-native-artifacts.json` and `scripts/download-rag-native.py`.

- `@langchain/textsplitters` 1.0.2 — MIT, Copyright LangChain, Inc. Used directly for recursive splitting; Sky Chat adds Unicode handling and parent/child orchestration. Package license: `node_modules/@langchain/textsplitters/LICENSE`. Source: https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-textsplitters
- `p-queue` 9.x — MIT, Copyright Sindre Sorhus. Used directly for process-local concurrency, rate limits and priority scheduling. Package license: `node_modules/p-queue/license`. Source: https://github.com/sindresorhus/p-queue
- RRF formulation in `lib/rag/ranking.ts` follows the MIT-licensed pgvector-python hybrid search example, with independently implemented weighted fusion and deduplication: https://github.com/pgvector/pgvector-python/blob/master/examples/hybrid_search/rrf.py
- Binary vector decoding follows the pgvector wire format (dimension, reserved field, big-endian float32 values): https://github.com/pgvector/pgvector/blob/master/src/vector.c

Pinned repository revisions for this research are recorded in `docs/research/rag-sources.json`. RAGFlow, Onyx and LlamaIndex were consulted for public architectural ideas; their applications and enterprise code were not copied into this project. This document is not a replacement for upstream licenses distributed with dependencies.
