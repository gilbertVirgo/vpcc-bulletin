import { describe, expect, it } from "vitest";
import { assertWritable, dbName, diffDocs, upserts } from "./lib.ts";

const uri = (db: string) => `mongodb+srv://u:p@cluster0.example.net/${db}?retryWrites=true`;

describe("dbName", () => {
  it("reads the path", () => {
    expect(dbName(uri("calendar_dev"))).toBe("calendar_dev");
    expect(dbName("mongodb://localhost:27017")).toBe("");
  });
});

describe("assertWritable", () => {
  it("allows *_dev", () => {
    expect(assertWritable(uri("calendar_dev"), [])).toBe("calendar_dev");
  });
  it("refuses production without the flag", () => {
    expect(() => assertWritable(uri("calendar"), [])).toThrow(/Refusing/);
  });
  it("allows production with --production", () => {
    expect(assertWritable(uri("calendar"), ["--production"])).toBe("calendar");
  });
  it("refuses production even with the flag when dev-only", () => {
    expect(() => assertWritable(uri("calendar"), ["--production"], true)).toThrow(/Refusing/);
  });
  it("refuses a URI with no database", () => {
    expect(() => assertWritable("mongodb://localhost:27017", ["--production"])).toThrow(/no database/);
  });
});

describe("diffDocs", () => {
  it("sorts desired docs into insert / update (with fields) / unchanged and lists DB-only docs as kept", () => {
    const current = [
      { _id: "x1", name: "Gil", roles: ["worship"], frequency: 0.8 },
      { _id: "x2", name: "Tom", roles: ["welcome"], frequency: 0.5 },
      { _id: "x3", name: "Old", roles: [], frequency: 1 },
    ];
    const desired = [
      { name: "Gil", roles: ["worship"], frequency: 0.8 },
      { name: "Tom", roles: ["welcome", "lyrics"], frequency: 0.6 },
      { name: "New", roles: [], frequency: 1 },
    ];
    expect(diffDocs(current, desired, "name")).toEqual({
      insert: ["New"],
      update: [{ key: "Tom", fields: ["roles", "frequency"] }],
      unchanged: ["Gil"],
      kept: ["Old"],
    });
  });
  it("compares nested values deeply", () => {
    const week = { date: "2030-01-06", assignments: { worship: ["a"] } };
    expect(diffDocs([week], [{ date: "2030-01-06", assignments: { worship: ["a"] } }], "date").unchanged).toEqual(["2030-01-06"]);
    expect(diffDocs([week], [{ date: "2030-01-06", assignments: { worship: ["b"] } }], "date").update).toEqual([
      { key: "2030-01-06", fields: ["assignments"] },
    ]);
  });
  it("insert-only: docs already in the DB are kept, never updated", () => {
    const current = [{ name: "Gil", roles: ["worship"], frequency: 0.8 }, { name: "Old", roles: [], frequency: 1 }];
    const desired = [{ name: "Gil", roles: ["lyrics"], frequency: 0.2 }, { name: "New", roles: [], frequency: 1 }];
    expect(diffDocs(current, desired, "name", true)).toEqual({ insert: ["New"], update: [], unchanged: [], kept: ["Gil", "Old"] });
  });
});

describe("upserts", () => {
  it("sets fields, or only sets them on insert", () => {
    const docs = [{ name: "Gil", frequency: 0.8 }];
    expect(upserts(docs, "name")).toEqual([
      { updateOne: { filter: { name: "Gil" }, update: { $set: { frequency: 0.8 } }, upsert: true } },
    ]);
    expect(upserts(docs, "name", true)[0].updateOne.update).toEqual({ $setOnInsert: { frequency: 0.8 } });
  });
});
