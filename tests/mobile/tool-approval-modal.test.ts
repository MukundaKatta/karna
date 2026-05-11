import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("mobile tool approval modal", () => {
  it("renders approve, deny, and approve-all actions", () => {
    const source = readFileSync(
      join(ROOT, "apps/mobile/components/ToolApprovalModal.tsx"),
      "utf-8",
    );

    expect(source).toContain("pendingToolApproval");
    expect(source).toContain("Deny");
    expect(source).toContain("Approve All");
    expect(source).toContain("Approve");
    expect(source).toContain("respondToToolApproval");
    expect(source).toContain("approveAllForSession: true");
  });

  it("is mounted from the chat screen", () => {
    const source = readFileSync(
      join(ROOT, "apps/mobile/app/(tabs)/chat/index.tsx"),
      "utf-8",
    );

    expect(source).toContain("ToolApprovalModal");
    expect(source).toContain("<ToolApprovalModal />");
  });
});
