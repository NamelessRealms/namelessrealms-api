/**
 * @file recycle.test.ts
 * @description 回收清理 script 邏輯測試：有 refs 不列孤兒、無 refs 列孤兒、dry-run（只列不刪）。
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

const { listObjectKeys, deleteFromS3, queryMock } = vi.hoisted(() => ({
  listObjectKeys: vi.fn(),
  deleteFromS3: vi.fn(async () => {}),
  queryMock: vi.fn(),
}));
vi.mock("../../src/api/utils/s3/s3", () => ({ listObjectKeys, deleteFromS3 }));
vi.mock("../../src/api/utils/mysql", () => ({
  default: { getPool: vi.fn(() => ({ query: queryMock })) },
}));

import { listOrphans, deleteOrphans } from "../../recycle_orphan_mods";

/** refCount：sha256 為 "AAA…" 回 1（有引用）、其餘回 0（孤兒） */
function refCountBySha() {
  queryMock.mockImplementation(async (_sql: string, params: any[]) => {
    const sha = params[0] as string;
    return [[{ n: sha.startsWith("aaa") ? 1 : 0 }], []];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  refCountBySha();
});

describe("recycle_orphan_mods", () => {
  it("有 refs 的不列孤兒、無 refs 的列孤兒", async () => {
    listObjectKeys.mockResolvedValue([
      "mods/files/aaa000.jar", // 有引用 → 不列
      "mods/files/bbb111.jar", // 無引用 → 列
    ]);

    const orphans = await listOrphans();
    expect(orphans).toEqual(["mods/files/bbb111.jar"]);
  });

  it("dry-run：只列不刪（deleteOrphans 未被呼叫時不刪任何物件）", async () => {
    listObjectKeys.mockResolvedValue(["mods/files/bbb111.jar"]);
    await listOrphans();
    expect(deleteFromS3).not.toHaveBeenCalled();
  });

  it("deleteOrphans：刪前再查引用仍為零才刪", async () => {
    const deleted = await deleteOrphans(["mods/files/bbb111.jar"]);
    expect(deleted).toBe(1);
    expect(deleteFromS3).toHaveBeenCalledWith("mods/files/bbb111.jar");
  });

  it("deleteOrphans：刪前發現引用已非零 → 跳過不刪", async () => {
    const deleted = await deleteOrphans(["mods/files/aaa000.jar"]);
    expect(deleted).toBe(0);
    expect(deleteFromS3).not.toHaveBeenCalled();
  });
});
