import { describe, it, expect, beforeEach } from "bun:test";
import { makeWordBoostDb } from "../wordBoostDb.js";
import { makeTestDb } from "./helpers/schema.js";
import type { Database } from "bun:sqlite";

describe("makeWordBoostDb", () => {
  let db: Database;
  let wordBoostDb: ReturnType<typeof makeWordBoostDb>;

  beforeEach(() => {
    db = makeTestDb();
    wordBoostDb = makeWordBoostDb(db);
  });

  it("addWord returns true when a new word is inserted", () => {
    expect(wordBoostDb.addWord("hello")).toBe(true);
  });

  it("addWord returns false on duplicate insert (INSERT OR IGNORE)", () => {
    wordBoostDb.addWord("hello");
    expect(wordBoostDb.addWord("hello")).toBe(false);
  });

  it("addWord trims whitespace before inserting", () => {
    wordBoostDb.addWord("  hello  ");
    expect(wordBoostDb.getWords()).toEqual(["hello"]);
  });

  it("removeWord returns false when the word does not exist", () => {
    expect(wordBoostDb.removeWord("missing")).toBe(false);
  });

  it("removeWord returns true and removes the word", () => {
    wordBoostDb.addWord("hello");
    expect(wordBoostDb.removeWord("hello")).toBe(true);
    expect(wordBoostDb.getWords()).toEqual([]);
  });

  it("getWords returns words sorted alphabetically", () => {
    wordBoostDb.addWord("banana");
    wordBoostDb.addWord("apple");
    wordBoostDb.addWord("cherry");
    expect(wordBoostDb.getWords()).toEqual(["apple", "banana", "cherry"]);
  });

  it("getWords returns empty array when table is empty", () => {
    expect(wordBoostDb.getWords()).toEqual([]);
  });

  it("COLLATE NOCASE: treats same word in different cases as a duplicate", () => {
    expect(wordBoostDb.addWord("Hello")).toBe(true);
    expect(wordBoostDb.addWord("hello")).toBe(false);
    expect(wordBoostDb.getWords()).toEqual(["Hello"]);
  });
});
