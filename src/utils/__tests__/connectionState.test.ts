import { describe, expect, it } from "vite-plus/test";
import { DOWN_AFTER_FAILED_RECONNECTS, stateAfterClose } from "../connectionState";

describe("stateAfterClose", () => {
  it("is connecting on the first close and while early reconnects fail", () => {
    expect(stateAfterClose(0)).toBe("connecting");
    expect(stateAfterClose(DOWN_AFTER_FAILED_RECONNECTS - 1)).toBe("connecting");
  });

  it("is down once the threshold of failed reconnects is reached", () => {
    expect(stateAfterClose(DOWN_AFTER_FAILED_RECONNECTS)).toBe("down");
    expect(stateAfterClose(50)).toBe("down");
  });

  it("honours a custom threshold", () => {
    expect(stateAfterClose(1, 1)).toBe("down");
  });
});
