import { describe, it, expect } from "vitest";
import {
  encodeCallbackId,
  parseCallbackId,
  supportsInlineApproval,
  renderSlackApproval,
  renderTelegramApproval,
  renderDiscordApproval,
  renderInlineApproval,
  parseInboundApproval,
} from "../../channels/_shared/inline-approval.js";

const TOKEN = "11111111-2222-4333-8444-555555555555";

describe("inline-approval callback id (#588)", () => {
  it("round-trips an encoded callback id", () => {
    const id = encodeCallbackId("approve", TOKEN);
    expect(parseCallbackId(id)).toEqual({ ok: true, token: TOKEN, decision: "approve" });
    expect(parseCallbackId(encodeCallbackId("deny", TOKEN))).toEqual({
      ok: true,
      token: TOKEN,
      decision: "deny",
    });
  });

  it("rejects non-approval and malformed ids", () => {
    expect(parseCallbackId("other:thing:approve:x").ok).toBe(false);
    expect(parseCallbackId("karna:approval:maybe:" + TOKEN)).toEqual({ ok: false, reason: "malformed" });
    expect(parseCallbackId("karna:approval:approve:").ok).toBe(false);
    expect(parseCallbackId(undefined).ok).toBe(false);
    expect(parseCallbackId("")).toEqual({ ok: false, reason: "malformed" });
  });

  it("keeps Telegram callback_data within the 64-byte limit", () => {
    const data = encodeCallbackId("approve", TOKEN);
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
  });
});

describe("supportsInlineApproval", () => {
  it("is true only for slack/telegram/discord", () => {
    expect(supportsInlineApproval("slack")).toBe(true);
    expect(supportsInlineApproval("telegram")).toBe(true);
    expect(supportsInlineApproval("discord")).toBe(true);
    expect(supportsInlineApproval("sms")).toBe(false);
    expect(supportsInlineApproval("irc")).toBe(false);
  });
});

describe("platform renderers embed the token and parse back", () => {
  const input = { token: TOKEN, prompt: "Approve running shell_exec?" };

  it("slack: actions block buttons carry the callback id; inbound parses", () => {
    const p = renderSlackApproval(input);
    const actions = (p.blocks[1] as { elements: Array<{ action_id: string }> }).elements;
    expect(actions[0].action_id).toBe(encodeCallbackId("approve", TOKEN));
    const inbound = { actions: [{ action_id: encodeCallbackId("deny", TOKEN) }] };
    expect(parseInboundApproval("slack", inbound)).toEqual({ ok: true, token: TOKEN, decision: "deny" });
  });

  it("telegram: inline_keyboard carries callback_data; inbound parses", () => {
    const p = renderTelegramApproval(input);
    const row = p.reply_markup.inline_keyboard[0];
    expect(row[0].callback_data).toBe(encodeCallbackId("approve", TOKEN));
    const inbound = { callback_query: { data: encodeCallbackId("approve", TOKEN) } };
    expect(parseInboundApproval("telegram", inbound)).toEqual({ ok: true, token: TOKEN, decision: "approve" });
  });

  it("discord: components carry custom_id; inbound parses", () => {
    const p = renderDiscordApproval(input);
    const btns = p.components[0].components;
    expect(btns[1].custom_id).toBe(encodeCallbackId("deny", TOKEN));
    expect(btns[1].custom_id.length).toBeLessThanOrEqual(100);
    const inbound = { data: { custom_id: encodeCallbackId("deny", TOKEN) } };
    expect(parseInboundApproval("discord", inbound)).toEqual({ ok: true, token: TOKEN, decision: "deny" });
  });

  it("renderInlineApproval routes per channel and returns undefined for unsupported", () => {
    expect(renderInlineApproval("slack", input)?.channel).toBe("slack");
    expect(renderInlineApproval("telegram", input)?.channel).toBe("telegram");
    expect(renderInlineApproval("discord", input)?.channel).toBe("discord");
    expect(renderInlineApproval("sms", input)).toBeUndefined();
  });

  it("ignores unrelated interactions", () => {
    expect(parseInboundApproval("slack", { actions: [{ action_id: "some_other_button" }] }).ok).toBe(false);
    expect(parseInboundApproval("telegram", {}).ok).toBe(false);
  });
});
