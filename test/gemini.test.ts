import { describe, it, expect, vi } from "vitest";
import { runReview } from "../src/gemini.ts";
import { GoogleGenAI } from "@google/genai";

vi.mock("@actions/core", () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@google/genai", () => {
  return {
    Type: {
      OBJECT: "OBJECT",
      STRING: "STRING",
      ARRAY: "ARRAY",
      INTEGER: "INTEGER",
    },
    GoogleGenAI: vi.fn().mockImplementation(function (this: any, options: any) {
      this.vertexai = options?.vertexai ?? false;
      this.models = {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            summary: "Looks good",
            findings: [],
          }),
        }),
      };
    }),
  };
});

describe("runReview with Gemini and Vertex AI", () => {
  it("initializes GoogleGenAI with vertexai: false and keeps model on Gemini API", async () => {
    const res = await runReview("prompt", "gemini-flash-latest", "gemini-key");
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "gemini-key",
      vertexai: false,
    });
    expect(res.summary).toBe("Looks good");
  });

  it("initializes GoogleGenAI with vertexai: true and maps gemini-flash-latest to gemini-2.5-flash", async () => {
    const res = await runReview("prompt", "gemini-flash-latest", "vertex-key", true);
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "vertex-key",
      vertexai: true,
    });
    expect(res.summary).toBe("Looks good");
  });

  it("preserves explicit model on Vertex AI", async () => {
    const res = await runReview("prompt", "gemini-3.7-flash", "vertex-key", true);
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "vertex-key",
      vertexai: true,
    });
    expect(res.summary).toBe("Looks good");
  });
});
