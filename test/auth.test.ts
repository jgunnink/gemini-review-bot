import { describe, it, expect } from "vitest";
import { resolveAuth } from "../src/auth.ts";

describe("resolveAuth", () => {
  it("uses GEMINI_API_KEY when only geminiApiKey is provided", () => {
    const auth = resolveAuth("test-gemini-key", undefined);
    expect(auth).toEqual({
      apiKey: "test-gemini-key",
      useVertex: false,
    });
  });

  it("uses AGENT_PLATFORM_API_KEY and enables Vertex AI when only agentPlatformApiKey is provided", () => {
    const auth = resolveAuth(undefined, "test-agent-platform-key");
    expect(auth).toEqual({
      apiKey: "test-agent-platform-key",
      useVertex: true,
    });
  });

  it("prioritizes GEMINI_API_KEY (nothing changes) when both keys are provided", () => {
    const auth = resolveAuth("test-gemini-key", "test-agent-platform-key");
    expect(auth).toEqual({
      apiKey: "test-gemini-key",
      useVertex: false,
    });
  });

  it("trims whitespace from keys", () => {
    const auth1 = resolveAuth("  gemini-trimmed  ", undefined);
    expect(auth1.apiKey).toBe("gemini-trimmed");
    expect(auth1.useVertex).toBe(false);

    const auth2 = resolveAuth("", "  vertex-trimmed  ");
    expect(auth2.apiKey).toBe("vertex-trimmed");
    expect(auth2.useVertex).toBe(true);
  });

  it("throws an error when neither key is provided", () => {
    expect(() => resolveAuth(undefined, undefined)).toThrow(
      /Neither gemini_api_key.*nor agent_platform_api_key/
    );
    expect(() => resolveAuth("", "")).toThrow(
      /Neither gemini_api_key.*nor agent_platform_api_key/
    );
    expect(() => resolveAuth("   ", "   ")).toThrow(
      /Neither gemini_api_key.*nor agent_platform_api_key/
    );
  });
});
