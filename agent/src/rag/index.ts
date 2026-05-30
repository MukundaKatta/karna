// ─── RAG Barrel ───────────────────────────────────────────────────────────────
// Public surface for the RAG subsystem. Additive: existing imports that target
// individual modules continue to work unchanged.

export * from "./chunker.js";
export * from "./retriever.js";
export * from "./pipeline.js";
export * from "./hybrid.js";
export * from "./ingestion.js";
export * from "./rerank.js";
export * from "./citations.js";
export * from "./incremental.js";
