import { describe, expect, it } from "vitest";
import type { SeedPerson, SeedRole } from "./lib.ts";
import { flipSheet, parseSheetDate } from "./sheet.ts";

const ROLES: SeedRole[] = [
  { id: "worship", name: "Worship", needs: 1, busyFor: [0, 1, 2], consecutiveDisabled: true },
  { id: "welcome", name: "Welcome", needs: 1, busyFor: [0] },
  { id: "lyrics", name: "Lyrics", needs: 1, busyFor: [0, 1] },
];
const PEOPLE: SeedPerson[] = [
  { name: "Gil", roles: ["worship", "lyrics", "welcome"], frequency: 0.8 },
  { name: "Tom", roles: ["welcome", "lyrics"], frequency: 0.8 },
  { name: "Dan", roles: ["welcome"], frequency: 0.8 },
];
const HEADER = ["Date", "Notes", "Gil", "tom ", "Dan", "Stranger"];

describe("parseSheetDate", () => {
  it.each([
    ["4 October 2026", "2026-10-04"],
    [" 11 october 2026 ", "2026-10-11"],
    ["31 February 2026", null],
    ["2026-10-04", null],
    ["", null],
  ])("%j -> %j", (s, want) => {
    expect(parseSheetDate(s)).toBe(want);
  });
});

describe("flipSheet", () => {
  it("flips person->role into role->people for today onwards", () => {
    const values = [
      HEADER,
      ["27 September 2026", "", "Worship Lead", "Welcome"],
      ["4 October 2026", "x", "Worship Lead", "Lyrics, Welcome", "Welcome", "Welcome"],
      ["11 October 2026", "", "Away", "", "welcome"],
    ];
    const { weeks, skipped } = flipSheet(values, "2026-09-30", ROLES, PEOPLE);
    expect(weeks).toEqual([
      { date: "2026-10-04", assignments: { worship: ["Gil"], welcome: ["Tom"], lyrics: ["Tom"] } },
      { date: "2026-10-11", assignments: { worship: [], welcome: ["Dan"], lyrics: [] } },
    ]);
    expect(skipped).toEqual([
      "Welcome on 2026-10-04 is full; dropped Dan",
      'Unknown person "Stranger"',
    ]);
  });

  it("reports unknown roles, non-holders, bad and non-Sunday dates", () => {
    const values = [
      HEADER,
      ["5 October 2026", "", "Lyrics"],
      ["someday", "", "Lyrics"],
      ["18 October 2026", "", "Preaching", "Worship"],
    ];
    const { weeks, skipped } = flipSheet(values, "2026-09-30", ROLES, PEOPLE);
    expect(weeks).toEqual([{ date: "2026-10-18", assignments: { worship: [], welcome: [], lyrics: [] } }]);
    expect(skipped).toEqual([
      "2026-10-05 is not a Sunday",
      'Unreadable date "someday"',
      'Unknown role "Preaching"',
      "Tom does not do Worship (2026-10-18)",
    ]);
  });

  it("returns nothing without a Date column", () => {
    expect(flipSheet([["When", "x"]], "2026-09-30", ROLES, PEOPLE)).toEqual({
      weeks: [],
      skipped: ['No "Date" column in the header row'],
    });
  });

  it("does not treat prototype keys as aliases", () => {
    const { skipped } = flipSheet([HEADER, ["4 October 2026", "", "constructor"]], "2026-09-30", ROLES, PEOPLE);
    expect(skipped).toEqual(['Unknown role "constructor"']);
  });
});
