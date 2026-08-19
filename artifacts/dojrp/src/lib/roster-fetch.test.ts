import { describe, expect, test } from "bun:test";
import {
  isFetchTimeoutError,
  rosterFetchErrorMessage,
} from "./roster-fetch";

describe("roster fetch errors", () => {
  test("detects AbortSignal timeout failures", () => {
    expect(isFetchTimeoutError(new DOMException("signal timed out", "AbortError"))).toBe(true);
    expect(isFetchTimeoutError(new Error("The operation was aborted due to timeout"))).toBe(true);
    expect(isFetchTimeoutError(new Error("Failed to load ranks."))).toBe(false);
  });

  test("maps timeout errors to a friendly message", () => {
    const err = new DOMException("signal timed out", "AbortError");
    expect(rosterFetchErrorMessage(err, "ranks")).toBe(
      "Failed to load ranks. The server took too long to respond — try again.",
    );
  });
});
