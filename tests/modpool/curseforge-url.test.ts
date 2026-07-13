/**
 * @file curseforge-url.test.ts
 * @description flxCurseforgeDownloadUrlNullIssues 純函式測試：一般案例、前導零剝除、
 *   檔名 encode、後段全零 guard、無效輸入 throw。
 */
import { describe, it, expect } from "vitest";
import { flxCurseforgeDownloadUrlNullIssues } from "../../src/api/utils/modpool/curseforge-url";

describe("flxCurseforgeDownloadUrlNullIssues", () => {
  it("一般案例：3215435 → /files/3215/435/", () => {
    expect(flxCurseforgeDownloadUrlNullIssues(3215435, "mod.jar")).toBe(
      "https://edge.forgecdn.net/files/3215/435/mod.jar"
    );
  });

  it("前導零剝除：2926027 → /files/2926/27/", () => {
    expect(flxCurseforgeDownloadUrlNullIssues(2926027, "mod.jar")).toBe(
      "https://edge.forgecdn.net/files/2926/27/mod.jar"
    );
  });

  it("含空白/括號檔名 → URL encode", () => {
    expect(
      flxCurseforgeDownloadUrlNullIssues(3215435, "My Mod v1.2 (final).jar")
    ).toBe(
      "https://edge.forgecdn.net/files/3215/435/My%20Mod%20v1.2%20(final).jar"
    );
  });

  it("後段全零 guard：3000000 → /files/3000/0/（不產雙斜線）", () => {
    expect(flxCurseforgeDownloadUrlNullIssues(3000000, "mod.jar")).toBe(
      "https://edge.forgecdn.net/files/3000/0/mod.jar"
    );
  });

  it("無效輸入（少於 5 位數）→ throw", () => {
    expect(() => flxCurseforgeDownloadUrlNullIssues(1234, "mod.jar")).toThrow();
  });
});
