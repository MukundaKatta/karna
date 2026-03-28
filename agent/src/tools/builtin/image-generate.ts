// ─── Image Generation Tool ──────────────────────────────────────────────────
// Generates images using OpenAI DALL-E or similar providers.

import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-image-generate" });

const ImageGenerateInputSchema = z.object({
  prompt: z.string().min(1).max(4000).describe("Description of the image to generate"),
  size: z.enum(["256x256", "512x512", "1024x1024", "1024x1792", "1792x1024"]).optional()
    .describe("Image dimensions. Default: 1024x1024"),
  quality: z.enum(["standard", "hd"]).optional()
    .describe("Image quality. Default: standard"),
  style: z.enum(["natural", "vivid"]).optional()
    .describe("Image style. Default: vivid"),
  n: z.literal(1).optional()
    .describe("Number of images. DALL-E 3 only supports n=1. Default: 1"),
});

export const imageGenerateTool: ToolDefinitionRuntime = {
  name: "image_generate",
  description:
    "Generate images from text descriptions using AI (DALL-E). " +
    "Provide a detailed prompt describing the desired image. " +
    "Returns URLs of generated images.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Description of the image to generate" },
      size: { type: "string", description: "Image dimensions", enum: ["256x256", "512x512", "1024x1024", "1024x1792", "1792x1024"] },
      quality: { type: "string", description: "Image quality", enum: ["standard", "hd"] },
      style: { type: "string", description: "Image style", enum: ["natural", "vivid"] },
      n: { type: "integer", description: "Number of images (1-4)", minimum: 1, maximum: 4 },
    },
    required: ["prompt"],
  },
  inputSchema: ImageGenerateInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 60_000,
  tags: ["media", "image", "generation"],

  async execute(input: Record<string, unknown>, _context: ToolExecutionContext): Promise<unknown> {
    const params = ImageGenerateInputSchema.parse(input);

    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      return { error: "OPENAI_API_KEY is required for image generation", urls: [] };
    }

    logger.info({ prompt: params.prompt.slice(0, 100), size: params.size }, "Generating image");

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey });

      const response = await client.images.generate({
        model: "dall-e-3",
        prompt: params.prompt,
        size: (params.size as "1024x1024") ?? "1024x1024",
        quality: params.quality ?? "standard",
        style: params.style ?? "vivid",
        n: params.n ?? 1,
      });

      const urls = (response.data ?? []).map((img) => img.url).filter(Boolean);
      const revisedPrompts = (response.data ?? []).map((img) => img.revised_prompt).filter(Boolean);

      logger.info({ imageCount: urls.length }, "Image generation complete");

      return {
        urls,
        revisedPrompts,
        model: "dall-e-3",
        size: params.size ?? "1024x1024",
      };
    } catch (error) {
      logger.error({ error: String(error) }, "Image generation failed");
      return { error: String(error), urls: [] };
    }
  },
};
