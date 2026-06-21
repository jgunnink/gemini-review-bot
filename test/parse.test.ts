import { describe, it, expect } from "vitest";
import { parseReview } from "../src/parse";

describe("parseReview", () => {
  it("parses a valid review object", () => {
    const out = parseReview(
      '{"summary":"looks good","findings":[{"file":"a.ts","line":3,"priority":"high","title":"bug","body":"fix it"}]}'
    );
    expect(out.summary).toBe("looks good");
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].priority).toBe("high");
  });

  it("drops malformed findings but keeps valid ones", () => {
    const out = parseReview(
      '{"summary":"x","findings":[{"file":"a.ts","line":3,"priority":"nope","title":"t","body":"b"},{"file":"b.ts","line":1,"priority":"low","title":"t","body":"b"}]}'
    );
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].file).toBe("b.ts");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseReview("{not json")).toThrow();
  });

  it("handles an empty findings array", () => {
    const out = parseReview('{"summary":"clean","findings":[]}');
    expect(out.findings).toHaveLength(0);
    expect(out.summary).toBe("clean");
  });
});
