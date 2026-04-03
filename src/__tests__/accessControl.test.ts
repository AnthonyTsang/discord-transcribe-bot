import { describe, it, expect, beforeEach } from "bun:test";
import { makeAccessControlDb } from "../accessControl.js";
import { makeTestDb } from "./helpers/schema.js";
import type { Database } from "bun:sqlite";

describe("makeAccessControlDb", () => {
  let db: Database;
  let acl: ReturnType<typeof makeAccessControlDb>;

  beforeEach(() => {
    db = makeTestDb();
    acl = makeAccessControlDb(db);
  });

  // canUseBot tests
  describe("canUseBot", () => {
    it("returns true when both role list and user list are empty (open access)", () => {
      expect(acl.canUseBot("user1", [])).toBe(true);
    });

    it("returns true when user is in the user list and no roles are checked", () => {
      acl.addAllowedUser("user1");
      expect(acl.canUseBot("user1", [])).toBe(true);
    });

    it("returns false when user is NOT in user list but there ARE users in the list", () => {
      acl.addAllowedUser("user2");
      expect(acl.canUseBot("user1", [])).toBe(false);
    });

    it("returns true when role is in the role list and user has that matching role", () => {
      acl.addAllowedRole("role1");
      expect(acl.canUseBot("user1", ["role1"])).toBe(true);
    });

    it("returns false when role is in the role list but user has NO matching role", () => {
      acl.addAllowedRole("role1");
      expect(acl.canUseBot("user1", ["role2"])).toBe(false);
    });

    it("returns true when user is explicitly in user list even if no matching role (user overrides role restriction)", () => {
      acl.addAllowedRole("role1");
      acl.addAllowedUser("user1");
      expect(acl.canUseBot("user1", ["role999"])).toBe(true);
    });
  });

  // addAllowedRole / removeAllowedRole / getAllowedRoles tests
  describe("roles", () => {
    it("addAllowedRole returns true on new insert", () => {
      expect(acl.addAllowedRole("role1")).toBe(true);
    });

    it("addAllowedRole returns false on duplicate insert", () => {
      acl.addAllowedRole("role1");
      expect(acl.addAllowedRole("role1")).toBe(false);
    });

    it("removeAllowedRole returns true when removing an existing role", () => {
      acl.addAllowedRole("role1");
      expect(acl.removeAllowedRole("role1")).toBe(true);
    });

    it("removeAllowedRole returns false when removing a non-existent role", () => {
      expect(acl.removeAllowedRole("role_missing")).toBe(false);
    });

    it("getAllowedRoles returns roles sorted alphabetically", () => {
      acl.addAllowedRole("charlie");
      acl.addAllowedRole("alpha");
      acl.addAllowedRole("bravo");
      expect(acl.getAllowedRoles()).toEqual(["alpha", "bravo", "charlie"]);
    });

    it("getAllowedRoles returns empty array when no roles exist", () => {
      expect(acl.getAllowedRoles()).toEqual([]);
    });
  });

  // addAllowedUser / removeAllowedUser / getAllowedUsers tests
  describe("users", () => {
    it("addAllowedUser returns true on new insert", () => {
      expect(acl.addAllowedUser("user1")).toBe(true);
    });

    it("addAllowedUser returns false on duplicate insert", () => {
      acl.addAllowedUser("user1");
      expect(acl.addAllowedUser("user1")).toBe(false);
    });

    it("removeAllowedUser returns true when removing an existing user", () => {
      acl.addAllowedUser("user1");
      expect(acl.removeAllowedUser("user1")).toBe(true);
    });

    it("removeAllowedUser returns false when removing a non-existent user", () => {
      expect(acl.removeAllowedUser("user_missing")).toBe(false);
    });

    it("getAllowedUsers returns users sorted alphabetically", () => {
      acl.addAllowedUser("charlie");
      acl.addAllowedUser("alpha");
      acl.addAllowedUser("bravo");
      expect(acl.getAllowedUsers()).toEqual(["alpha", "bravo", "charlie"]);
    });

    it("getAllowedUsers returns empty array when no users exist", () => {
      expect(acl.getAllowedUsers()).toEqual([]);
    });
  });
});
