import { describe, it, expect } from "vitest";
import { vol } from "memfs";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { deleteFile, listTrash, restoreFromTrash, emptyTrash } from "../tools/delete.js";
import { readFile } from "../tools/read.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("trash management", () => {
  describe("deleteFile (soft)", () => {
    it("moves file to .trash", async () => {
      await createFile("/vault/to-trash.md", "Trash me", config);

      const result = await deleteFile("/vault/to-trash.md", config, false);
      const data = getTestResult(result) as { success: boolean; trashedTo: string };

      expect(data.success).toBe(true);
      expect(data.trashedTo).toContain(".trash");

      // Original file should not exist
      const readResult = await readFile("/vault/to-trash.md", config);
      expect(readResult.isError).toBe(true);
    });
  });

  describe("listTrash", () => {
    it("lists items in trash", async () => {
      // Create and delete a file
      await createFile("/vault/trash-item.md", "Content", config);
      await deleteFile("/vault/trash-item.md", config, false);

      const result = await listTrash(config);
      const data = getTestResult(result) as {
        items: { originalName: string; trashedAt: string }[];
        totalItems: number;
      };

      expect(data.totalItems).toBeGreaterThan(0);
      expect(data.items.some((item) => item.originalName === "trash-item.md")).toBe(true);
    });

    it("includes timestamp information", async () => {
      await createFile("/vault/timed-trash.md", "Content", config);
      await deleteFile("/vault/timed-trash.md", config, false);

      const result = await listTrash(config);
      const data = getTestResult(result) as { items: { trashedAt: string }[] };

      expect(data.items[0].trashedAt).toBeDefined();
      // Should be a valid ISO date
      expect(new Date(data.items[0].trashedAt).getTime()).not.toBeNaN();
    });
  });

  describe("restoreFromTrash", () => {
    it("restores file from trash", async () => {
      await createFile("/vault/restore-me.md", "Restore this content", config);
      const deleteResult = await deleteFile("/vault/restore-me.md", config, false);
      const deleteData = getTestResult(deleteResult) as { trashedTo: string };

      // Get the trashed filename
      const trashedPath = deleteData.trashedTo;

      const result = await restoreFromTrash(trashedPath, config, "/vault/restore-me.md", false);
      const data = getTestResult(result) as { success: boolean };

      expect(data.success).toBe(true);

      // File should be restored
      const readResult = await readFile("/vault/restore-me.md", config);
      const readData = getTestResult(readResult) as { content: string };
      expect(readData.content).toBe("Restore this content");
    });

    it("restores to custom path", async () => {
      await createFile("/vault/original.md", "Original content", config);
      const deleteResult = await deleteFile("/vault/original.md", config, false);
      const deleteData = getTestResult(deleteResult) as { trashedTo: string };

      const trashedPath = deleteData.trashedTo;

      const result = await restoreFromTrash(trashedPath, config, "/vault/restored-elsewhere.md", false);
      const data = getTestResult(result) as { success: boolean; restoredTo: string };

      expect(data.success).toBe(true);
      expect(data.restoredTo).toBe("/vault/restored-elsewhere.md");

      // File should exist at new location
      const readResult = await readFile("/vault/restored-elsewhere.md", config);
      expect(readResult.isError).toBeFalsy();
    });

    it("returns error if destination exists without overwrite", async () => {
      await createFile("/vault/will-conflict.md", "Content 1", config);
      const deleteResult = await deleteFile("/vault/will-conflict.md", config, false);
      const deleteData = getTestResult(deleteResult) as { trashedTo: string };

      // Create another file at the restore location
      await createFile("/vault/will-conflict.md", "Content 2", config);

      const result = await restoreFromTrash(deleteData.trashedTo, config, "/vault/will-conflict.md", false);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("already exists");
    });

    it("returns error for non-existent trash item", async () => {
      const result = await restoreFromTrash("/vault/.trash/nonexistent.1234567890", config);
      expect(result.isError).toBe(true);
    });
  });

  describe("emptyTrash", () => {
    it("requires confirmation", async () => {
      const result = await emptyTrash(config, false);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("confirm");
    });

    it("empties all trash items", async () => {
      // Create and trash some files
      await createFile("/vault/empty-me-1.md", "Content 1", config);
      await createFile("/vault/empty-me-2.md", "Content 2", config);
      await deleteFile("/vault/empty-me-1.md", config, false);
      await deleteFile("/vault/empty-me-2.md", config, false);

      // Verify items are in trash
      const beforeResult = await listTrash(config);
      const beforeData = getTestResult(beforeResult) as { totalItems: number };
      expect(beforeData.totalItems).toBeGreaterThanOrEqual(2);

      // Empty trash
      const result = await emptyTrash(config, true);
      const data = getTestResult(result) as { success: boolean; deletedCount: number };

      expect(data.success).toBe(true);
      expect(data.deletedCount).toBeGreaterThanOrEqual(2);

      // Trash should be empty
      const afterResult = await listTrash(config);
      const afterData = getTestResult(afterResult) as { totalItems: number };
      expect(afterData.totalItems).toBe(0);
    });

    it("empties only items older than N days", async () => {
      // Create and trash a file
      await createFile("/vault/old-trash.md", "Old content", config);
      await deleteFile("/vault/old-trash.md", config, false);

      // Emptying with olderThan=0 should delete everything (all items are older than 0 days ago)
      // but with a very large olderThan, nothing should be deleted since items are recent
      const result = await emptyTrash(config, true, 9999);
      const data = getTestResult(result) as { success: boolean; deletedCount: number };

      expect(data.success).toBe(true);
      expect(data.deletedCount).toBe(0);
    });

    it("handles directories in trash", async () => {
      // Manually create a directory in trash to simulate trashed directories
      vol.mkdirSync("/vault/.trash/old-dir.123456", { recursive: true });
      vol.writeFileSync("/vault/.trash/old-dir.123456/file.md", "content");

      const result = await emptyTrash(config, true);
      const data = getTestResult(result) as { success: boolean; deletedCount: number };

      expect(data.success).toBe(true);
      expect(data.deletedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("restoreFromTrash (additional)", () => {
    it("restores to parent directory that does not exist", async () => {
      await createFile("/vault/deep-restore.md", "Deep content", config);
      const deleteResult = await deleteFile("/vault/deep-restore.md", config, false);
      const deleteData = getTestResult(deleteResult) as { trashedTo: string };

      const result = await restoreFromTrash(
        deleteData.trashedTo,
        config,
        "/vault/new-parent/sub/deep-restore.md"
      );
      const data = getTestResult(result) as { success: boolean };
      expect(data.success).toBe(true);

      // File should exist at nested path
      const readResult = await readFile("/vault/new-parent/sub/deep-restore.md", config);
      const readData = getTestResult(readResult) as { content: string };
      expect(readData.content).toBe("Deep content");
    });

    it("restores to default location (vault root) when no restoreTo given", async () => {
      await createFile("/vault/default-restore.md", "Restore me", config);
      const deleteResult = await deleteFile("/vault/default-restore.md", config, false);
      const deleteData = getTestResult(deleteResult) as { trashedTo: string };

      const result = await restoreFromTrash(deleteData.trashedTo, config);
      const data = getTestResult(result) as { success: boolean; restoredTo: string };
      expect(data.success).toBe(true);
      expect(data.restoredTo).toContain("default-restore.md");
    });
  });
});
