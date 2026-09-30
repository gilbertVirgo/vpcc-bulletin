import { describe, expect, it } from "vitest";
import { assertWritable, dbName } from "./lib.ts";

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
