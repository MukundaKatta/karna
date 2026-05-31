// ─── Knowledge-Graph Memory Tests (Issue #621) ───────────────────────────────

import { describe, it, expect } from "vitest";
import {
  GraphMemoryStore,
  EntitySchema,
  RelationSchema,
  GraphExtractionSchema,
  normalizeEntityId,
  heuristicGraphExtractor,
  extractGraph,
  toContextSnippets,
  type GraphExtractor,
  type GraphTextInput,
} from "../../agent/src/memory/graph-memory.js";

function text(content: string, overrides: Partial<GraphTextInput> = {}): GraphTextInput {
  return { content, ...overrides };
}

describe("schemas & normalization", () => {
  it("normalizes free-form names to stable ids", () => {
    expect(normalizeEntityId("  Alice  Smith! ")).toBe("alice_smith");
    expect(normalizeEntityId("Project: Karna")).toBe("project_karna");
    expect(normalizeEntityId("---")).toBe("");
  });

  it("applies schema defaults", () => {
    const e = EntitySchema.parse({ id: "x", name: "X" });
    expect(e.type).toBe("thing");
    expect(e.attributes).toEqual({});
    const r = RelationSchema.parse({ from: "a", to: "b" });
    expect(r.type).toBe("related_to");
    expect(r.weight).toBe(1);
    expect(RelationSchema.safeParse({ from: "a", to: "b", weight: 0 }).success).toBe(false);
  });

  it("accepts partial entity/relation lists in extraction", () => {
    const ok = GraphExtractionSchema.parse({
      entities: [{ name: "Alice" }],
      relations: [{ from: "alice", to: "karna" }],
    });
    expect(ok.entities[0].name).toBe("Alice");
    expect(ok.relations[0].from).toBe("alice");
  });
});

describe("heuristic extractor", () => {
  it("extracts capitalized entities and a typed relation", () => {
    const out = heuristicGraphExtractor([text("Alice works on Karna.")]);
    const names = out.entities.map((e) => e.name);
    expect(names).toContain("Alice");
    expect(names).toContain("Karna");
    expect(out.relations).toHaveLength(1);
    expect(out.relations[0].type).toBe("works_on");
    expect(out.relations[0].from).toBe("alice");
    expect(out.relations[0].to).toBe("karna");
  });

  it("ignores stop-words and empty input", () => {
    const out = heuristicGraphExtractor([text("The team is great."), text("   ")]);
    const names = out.entities.map((e) => e.name);
    expect(names).not.toContain("The");
  });
});

describe("upsert & dedup", () => {
  it("dedups entities arriving under different surface forms", () => {
    const g = new GraphMemoryStore();
    g.upsertEntity({ name: "Alice Smith" });
    g.upsertEntity({ id: "Alice  Smith", name: "ALICE SMITH", type: "person" });
    expect(g.entityCount).toBe(1);
    const e = g.getEntity("alice smith");
    expect(e?.type).toBe("person"); // non-default type promoted
    expect(e?.name).toBe("Alice Smith"); // first-seen canonical name kept
  });

  it("merges attributes with new values winning", () => {
    const g = new GraphMemoryStore();
    g.upsertEntity({ name: "Karna", attributes: { lang: "ts", stage: "alpha" } });
    g.upsertEntity({ name: "Karna", attributes: { stage: "beta" } });
    expect(g.getEntity("karna")?.attributes).toEqual({ lang: "ts", stage: "beta" });
  });

  it("accumulates weight on repeated relations and auto-creates endpoints", () => {
    const g = new GraphMemoryStore();
    g.upsertRelation({ from: "Alice", to: "Karna", type: "works_on", weight: 1 });
    g.upsertRelation({ from: "Alice", to: "Karna", type: "works_on", weight: 2 });
    expect(g.relationCount).toBe(1);
    expect(g.allRelations()[0].weight).toBe(3);
    expect(g.entityCount).toBe(2); // endpoints auto-created
  });

  it("ingests a raw extraction and skips malformed", () => {
    const g = new GraphMemoryStore();
    const applied = g.ingest({ entities: [{ name: "Bob" }], relations: [{ from: "bob", to: "acme" }] });
    expect(applied.entities).toBe(1);
    expect(applied.relations).toBe(1);
    expect(g.ingest({ entities: "nope" }).entities).toBe(0);
  });
});

describe("graph queries", () => {
  function buildGraph(): GraphMemoryStore {
    const g = new GraphMemoryStore();
    // Alice -> Karna -> Bob ; Karna -> Acme ; Dana isolated
    g.upsertRelation({ from: "Alice", to: "Karna", type: "works_on" });
    g.upsertRelation({ from: "Bob", to: "Karna", type: "works_on" });
    g.upsertRelation({ from: "Karna", to: "Acme", type: "owned_by" });
    g.upsertEntity({ name: "Dana" });
    return g;
  }

  it("neighbors depth 1 returns direct edges only", () => {
    const g = buildGraph();
    const n = g.neighbors("Karna", 1).map((x) => x.entity.id).sort();
    expect(n).toEqual(["acme", "alice", "bob"]);
  });

  it("neighbors depth 2 reaches transitive nodes", () => {
    const g = buildGraph();
    const n = g.neighbors("Alice", 2).map((x) => x.entity.id).sort();
    // Alice -> Karna (d1) -> Bob, Acme (d2)
    expect(n).toEqual(["acme", "bob", "karna"]);
  });

  it("neighbors records reversed direction", () => {
    const g = buildGraph();
    const toKarna = g.neighbors("Karna", 1).find((x) => x.entity.id === "alice");
    // Edge is Alice -> Karna, so from Karna's perspective it's reversed.
    expect(toKarna?.reversed).toBe(true);
    const toAcme = g.neighbors("Karna", 1).find((x) => x.entity.id === "acme");
    expect(toAcme?.reversed).toBe(false);
  });

  it("neighbors of unknown entity is empty", () => {
    expect(buildGraph().neighbors("nobody")).toEqual([]);
  });

  it("findPath returns shortest hop path via BFS", () => {
    const g = buildGraph();
    expect(g.findPath("Alice", "Bob")).toEqual(["alice", "karna", "bob"]);
    expect(g.findPath("Karna", "Karna")).toEqual(["karna"]);
  });

  it("findPath returns null when disconnected or unknown", () => {
    const g = buildGraph();
    expect(g.findPath("Alice", "Dana")).toBeNull();
    expect(g.findPath("Alice", "ghost")).toBeNull();
  });

  it("subgraph returns induced entities and internal relations", () => {
    const g = buildGraph();
    const sub = g.subgraph(["Alice", "Karna"]);
    expect(sub.entities.map((e) => e.id).sort()).toEqual(["alice", "karna"]);
    expect(sub.relations).toHaveLength(1);
    expect(sub.relations[0].type).toBe("works_on");
    // Edge to Acme excluded since Acme not in the set.
  });
});

describe("extraction pipeline with injected extractor", () => {
  it("runs a fake extractor and ingests results", async () => {
    const fake: GraphExtractor = (inputs) => {
      expect(inputs).toHaveLength(1);
      return {
        entities: [{ name: "Mukunda", type: "person" }, { name: "Karna", type: "project" }],
        relations: [{ from: "mukunda", to: "karna", type: "maintains", weight: 2 }],
      };
    };
    const g = new GraphMemoryStore();
    const { extraction, applied } = await extractGraph([text("...")], g, fake);
    expect(extraction.entities).toHaveLength(2);
    expect(applied.relations).toBe(1);
    expect(g.getEntity("mukunda")?.type).toBe("person");
    expect(g.allRelations()[0].weight).toBe(2);
  });

  it("defaults to the heuristic extractor", async () => {
    const g = new GraphMemoryStore();
    await extractGraph([text("Carol works on Atlas.")], g);
    expect(g.getEntity("carol")).toBeDefined();
    expect(g.findPath("Carol", "Atlas")).toEqual(["carol", "atlas"]);
  });

  it("survives a throwing extractor without mutating the graph", async () => {
    const g = new GraphMemoryStore();
    const boom: GraphExtractor = () => {
      throw new Error("boom");
    };
    const { applied } = await extractGraph([text("x")], g, boom);
    expect(applied).toEqual({ entities: 0, relations: 0 });
    expect(g.entityCount).toBe(0);
  });
});

describe("context linearization", () => {
  function buildGraph(): GraphMemoryStore {
    const g = new GraphMemoryStore();
    g.upsertEntity({ name: "Alice", type: "person", attributes: { role: "lead" } });
    g.upsertRelation({ from: "Alice", to: "Karna", type: "works_on", weight: 3 });
    g.upsertRelation({ from: "Alice", to: "Bob", type: "knows", weight: 1 });
    return g;
  }

  it("emits a focus descriptor and weight-ordered facts", () => {
    const lines = toContextSnippets(buildGraph(), "Alice");
    expect(lines[0]).toBe("Alice is a person (role: lead).");
    // works_on (weight 3) before knows (weight 1)
    expect(lines[1]).toBe("Alice works on Karna.");
    expect(lines[2]).toBe("Alice knows Bob.");
  });

  it("respects maxFacts", () => {
    const lines = toContextSnippets(buildGraph(), "Alice", { maxFacts: 2 });
    // 1 descriptor + (maxFacts - 1) facts
    expect(lines).toHaveLength(2);
  });

  it("linearizes the whole graph when no focus is given", () => {
    const lines = toContextSnippets(buildGraph());
    expect(lines).toContain("Alice works on Karna.");
    expect(lines).toContain("Alice knows Bob.");
  });

  it("returns empty for an unknown focus entity", () => {
    expect(toContextSnippets(buildGraph(), "ghost")).toEqual([]);
  });
});
