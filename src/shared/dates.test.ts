import { describe, expect, it } from "vitest";
import { addDays, isRealDate, isSunday, londonISO, nextSunday, shortDate } from "./dates";

describe("dates", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDays("2026-10-04", -7)).toBe("2026-09-27");
  });
  it("rejects impossible dates", () => {
    expect(isRealDate("2026-10-04")).toBe(true);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("4 Oct")).toBe(false);
  });
  it("knows Sundays", () => {
    expect(isSunday("2026-10-04")).toBe(true);
    expect(isSunday("2026-10-05")).toBe(false);
  });
  it("reads the London day of an instant", () => {
    expect(londonISO(new Date("2026-09-22T23:00:00Z"))).toBe("2026-09-23");
  });
  it("finds the coming Sunday, today included", () => {
    expect(nextSunday(new Date("2026-09-30T12:00:00Z"))).toBe("2026-10-04");
    expect(nextSunday(new Date("2026-10-04T08:00:00Z"))).toBe("2026-10-04");
    expect(nextSunday(new Date("2026-10-03T23:30:00Z"))).toBe("2026-10-04"); // already Sunday in BST
  });
  it("formats a short date", () => {
    expect(shortDate("2026-10-04")).toBe("Sun 4 Oct");
  });
});
