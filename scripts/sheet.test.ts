import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SeedPerson, SeedRole } from "./lib.ts";
import { parseSheet, parseSheetDate } from "./sheet.ts";

const ROLES: SeedRole[] = [
  { id: "worship", name: "Worship", needs: 1, busyFor: [0, 1, 2], consecutiveDisabled: true },
  { id: "creche", name: "Crêche", needs: 1, busyFor: [1] },
  { id: "welcome", name: "Welcome", needs: 2, busyFor: [0] },
  { id: "refreshments", name: "Refreshments", needs: 1, busyFor: [0, 2] },
  { id: "preaching", name: "Preaching", needs: 1, busyFor: [], manual: true },
];
const PEOPLE: SeedPerson[] = [
  { name: "Gil", roles: ["worship", "welcome"], frequency: 0.8 },
  { name: "Tom", roles: ["welcome", "creche"], frequency: 0.8 },
  { name: "Dan", roles: ["welcome"], frequency: 0.8 },
  { name: "Pascal (supervised by Gil)", roles: ["welcome"], frequency: 0.2 },
];
const HEADER = [" Date", "Worship", "crêche ", "Welcome", "Preaching"];
const empty = { worship: [], creche: [], welcome: [], refreshments: [], preaching: [] };

describe("parseSheetDate", () => {
  it.each([
    ["June 7 2026", "2026-06-07"],
    [" october 11 2026 ", "2026-10-11"],
    ["October 11, 2026", "2026-10-11"],
    ["4 October 2026", "2026-10-04"],
    ["February 31 2026", null],
    ["31 February 2026", null],
    ["2026-10-04", null],
    ["Smarch 4 2026", null],
    ["", null],
  ])("%j -> %j", (s, want) => {
    expect(parseSheetDate(s)).toBe(want);
  });
});

describe("parseSheet", () => {
  it("reads role columns by name into weeks, past included, skipping blank rows", () => {
    const values = [
      HEADER,
      ["June 7 2026", "Gil", "Tom", "Dan, pascal (supervised by gil)", "Tom"],
      ["June 14 2026"],
      ["June 21 2026", "", "", "", ""],
      ["October 4 2026", "", "", "", "Gil"],
    ];
    expect(parseSheet(values, ROLES, PEOPLE)).toEqual({
      weeks: [
        { date: "2026-06-07", assignments: { worship: ["Gil"], creche: ["Tom"], welcome: ["Dan", "Pascal (supervised by Gil)"], refreshments: [], preaching: ["Tom"] } },
        { date: "2026-10-04", assignments: { ...empty, preaching: ["Gil"] } },
      ],
      skipped: [],
    });
  });

  it("skips and reports unknown people, non-holders, overfull cells, unknown columns and bad dates", () => {
    const values = [
      [...HEADER, "Coffee"],
      ["June 14 2026", "Tom", "", "Gil, Piper, Dan, Tom", "", "Gil"],
      ["June 15 2026", "Gil"],
      ["someday", "Gil"],
      ["June 21 2026", "", "", "Piper"],
    ];
    const { weeks, skipped } = parseSheet(values, ROLES, PEOPLE);
    expect(weeks).toEqual([{ date: "2026-06-14", assignments: { ...empty, welcome: ["Gil", "Dan"] } }]);
    expect(skipped).toEqual([
      'Unknown role column "Coffee"',
      "Tom does not do Worship (2026-06-14)",
      'Unknown person "Piper"',
      "Welcome on 2026-06-14 is full; dropped Tom",
      "2026-06-15 is not a Sunday",
      'Unreadable date "someday"',
    ]);
  });

  it("returns nothing without a Date column", () => {
    expect(parseSheet([["When", "Worship"]], ROLES, PEOPLE)).toEqual({ weeks: [], skipped: ['No "Date" column in the header row'] });
  });

  it("does not treat prototype keys as aliases", () => {
    expect(parseSheet([["Date", "constructor"]], ROLES, PEOPLE).skipped).toEqual(['Unknown role column "constructor"']);
    expect(parseSheet([["Date", "Welcome"], ["June 7 2026", "constructor"]], ROLES, PEOPLE).skipped).toEqual([
      'Unknown person "constructor"',
    ]);
  });

  it("parses the fixture", () => {
    const values = JSON.parse(readFileSync(new URL("./fixtures/sheet.json", import.meta.url), "utf8"));
    const { weeks, skipped } = parseSheet(values, ROLES, PEOPLE);
    expect(weeks.map((w) => w.date)).toEqual(["2026-06-07", "2026-06-14", "2026-10-04"]);
    expect(skipped).toEqual(expect.arrayContaining(['Unknown person "Piper"']));
  });
});
