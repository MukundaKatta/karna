import { describe, it, expect } from "vitest";
import { chunkText } from "../../agent/src/rag/chunker.js";
import { RAGRetriever } from "../../agent/src/rag/retriever.js";
import { RAGPipeline } from "../../agent/src/rag/pipeline.js";
import { InMemoryBackend } from "../../agent/src/memory/store.js";

describe("RAG Pipeline", () => {
  describe("Chunker", () => {
    it("returns empty for empty text", () => {
      expect(chunkText("")).toEqual([]);
      expect(chunkText("  ")).toEqual([]);
    });

    it("returns single chunk for short text", () => {
      const chunks = chunkText("Hello world");
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe("Hello world");
      expect(chunks[0].index).toBe(0);
    });

    it("splits long text into multiple chunks", () => {
      // Generate text that's definitely longer than 512 tokens (~2048 chars)
      const paragraphs = Array.from({ length: 20 }, (_, i) =>
        `Paragraph ${i + 1}: ${"This is a test sentence that adds content. ".repeat(10)}`
      ).join("\n\n");

      const chunks = chunkText(paragraphs, { chunkSize: 256, overlap: 32 });
      expect(chunks.length).toBeGreaterThan(1);

      // Each chunk should have metadata
      for (const chunk of chunks) {
        expect(chunk.id).toBeTruthy();
        expect(chunk.tokenCount).toBeGreaterThan(0);
        expect(chunk.content.length).toBeGreaterThan(0);
      }
    });

    it("respects custom chunk size", () => {
      const text = "Word. ".repeat(500); // ~500 words
      const smallChunks = chunkText(text, { chunkSize: 50 });
      const largeChunks = chunkText(text, { chunkSize: 500 });
      expect(smallChunks.length).toBeGreaterThan(largeChunks.length);
    });

    it("includes metadata in chunks", () => {
      const chunks = chunkText("Test content here.", {
        metadata: { source: "test.md" },
      });
      expect(chunks[0].metadata).toMatchObject({ source: "test.md" });
    });
  });

  describe("Retriever", () => {
    it("retrieves results from backend", async () => {
      const backend = new InMemoryBackend();
      await backend.save({
        agentId: "agent-1",
        content: "TypeScript is a typed superset of JavaScript",
        source: "document",
        embedding: [1, 0, 0],
        tags: [],
      });
      await backend.save({
        agentId: "agent-1",
        content: "Python is a dynamic language",
        source: "document",
        embedding: [0, 1, 0],
        tags: [],
      });

      const retriever = new RAGRetriever(backend);
      const results = await retriever.retrieve(
        "What is TypeScript?",
        [0.9, 0.1, 0],
        "agent-1",
        { topK: 5 },
      );

      expect(results.length).toBeGreaterThan(0);
      // First result should be the TypeScript one (closer embedding)
      expect(results[0].content).toContain("TypeScript");
    });
  });

  describe("Pipeline", () => {
    it("ingests and queries a document", async () => {
      const backend = new InMemoryBackend();
      const mockEmbed = async (_text: string) => [0.5, 0.5, 0.5];

      const pipeline = new RAGPipeline(backend, mockEmbed);

      // Ingest
      const result = await pipeline.ingest(
        "TypeScript is a typed superset of JavaScript. It adds static typing to the language.",
        { agentId: "agent-1", title: "TypeScript Intro" },
      );

      expect(result.chunksCreated).toBeGreaterThan(0);

      // Query
      const queryResult = await pipeline.query("What is TypeScript?", {
        agentId: "agent-1",
        topK: 3,
      });

      expect(queryResult.results.length).toBeGreaterThan(0);
      expect(queryResult.context).toContain("TypeScript");
    });

    it("handles missing embed function gracefully", async () => {
      const backend = new InMemoryBackend();
      const pipeline = new RAGPipeline(backend); // No embed function

      const result = await pipeline.ingest("Test document", {
        agentId: "agent-1",
      });

      expect(result.chunksCreated).toBeGreaterThan(0);
    });

    it("returns empty context for no results", async () => {
      const backend = new InMemoryBackend();
      const pipeline = new RAGPipeline(backend);

      const queryResult = await pipeline.query("Random question", {
        agentId: "agent-1",
      });

      expect(queryResult.context).toBe("");
      expect(queryResult.results).toHaveLength(0);
    });
  });
});
