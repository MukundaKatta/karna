import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const SCREENS = [
  {
    name: "Tasks",
    path: "apps/mobile/app/(tabs)/tasks/index.tsx",
    refreshMethod: "refreshTasks",
  },
  {
    name: "Memory",
    path: "apps/mobile/app/(tabs)/memory/index.tsx",
    refreshMethod: "refreshMemories",
  },
  {
    name: "Skills",
    path: "apps/mobile/app/(tabs)/skills/index.tsx",
    refreshMethod: "refreshSkills",
  },
];

describe("mobile pull-to-refresh", () => {
  it.each(SCREENS)(
    "$name screen wires refresh control, gateway reload, and haptics",
    ({ path, refreshMethod }) => {
      const source = readFileSync(join(ROOT, path), "utf-8");

      expect(source).toContain("RefreshControl");
      expect(source).toContain("refreshing={refreshing}");
      expect(source).toContain("onRefresh={handleRefresh}");
      expect(source).toContain("playHaptic('pullToRefresh')");
      expect(source).toContain(`gatewayClient.${refreshMethod}`);
    },
  );

  it("gateway client exposes refresh methods for all list screens", () => {
    const source = readFileSync(
      join(ROOT, "apps/mobile/lib/gateway-client.ts"),
      "utf-8",
    );

    expect(source).toContain("async refreshTasks()");
    expect(source).toContain('type: "reminder.list"');
    expect(source).toContain("async refreshMemories(");
    expect(source).toContain('memoryUrl.pathname = "/api/memory"');
    expect(source).toContain("async refreshSkills()");
    expect(source).toContain('skillsUrl.pathname = "/api/skills"');
  });
});
