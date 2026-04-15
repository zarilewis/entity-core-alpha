/**
 * File-based Storage
 *
 * Handles reading and writing identity files and memories from disk.
 * All files are stored from my first-person perspective.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { IdentityFile, MemoryEntry, IdentityContent, Granularity } from "../types.ts";

/**
 * File store for my identity and memories.
 */
export class FileStore {
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /**
   * Get the data directory path.
   */
  get dataDirectory(): string {
    return this.dataDir;
  }

  /**
   * Initialize the storage directories.
   */
  async initialize(): Promise<void> {
    const dirs = [
      join(this.dataDir, "self"),
      join(this.dataDir, "user"),
      join(this.dataDir, "relationship"),
      join(this.dataDir, "custom"),
      join(this.dataDir, "memories", "daily"),
      join(this.dataDir, "memories", "weekly"),
      join(this.dataDir, "memories", "monthly"),
      join(this.dataDir, "memories", "yearly"),
      join(this.dataDir, "memories", "significant"),
      join(this.dataDir, "memories", "archive", "daily"),
    ];

    for (const dir of dirs) {
      await ensureDir(dir);
    }
  }

  // ===== Identity Files =====

  /**
   * Read all identity files from a category.
   */
  async readIdentityCategory(category: "self" | "user" | "relationship" | "custom"): Promise<IdentityFile[]> {
    const dir = join(this.dataDir, category);
    const files: IdentityFile[] = [];

    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith(".md")) {
          const filePath = join(dir, entry.name);
          const content = await Deno.readTextFile(filePath);
          const stat = await Deno.stat(filePath);

          files.push({
            category,
            filename: entry.name,
            content,
            version: 1, // TODO: Track actual versions
            lastModified: stat.mtime?.toISOString() ?? new Date().toISOString(),
            modifiedBy: "unknown", // TODO: Track modifier
          });
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    // Custom files are sorted alphabetically; others use predefined order
    if (category === "custom") {
      files.sort((a, b) => a.filename.localeCompare(b.filename));
    } else {
      const order = IDENTITY_FILE_ORDER[category as "self" | "user" | "relationship"];
      files.sort((a, b) => {
        const aIndex = order.indexOf(a.filename);
        const bIndex = order.indexOf(b.filename);
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.filename.localeCompare(b.filename);
      });
    }

    return files;
  }

  /**
   * Read all identity files.
   */
  async readAllIdentity(): Promise<IdentityContent> {
    const [self, user, relationship, custom] = await Promise.all([
      this.readIdentityCategory("self"),
      this.readIdentityCategory("user"),
      this.readIdentityCategory("relationship"),
      this.readIdentityCategory("custom"),
    ]);

    return { self, user, relationship, custom };
  }

  /**
   * Write an identity file.
   */
  async writeIdentityFile(file: IdentityFile): Promise<void> {
    const dir = join(this.dataDir, file.category);
    await ensureDir(dir);
    const filePath = join(dir, file.filename);
    await Deno.writeTextFile(filePath, file.content);
  }

  /**
   * Delete a custom identity file.
   * Only custom files can be deleted; predefined files in other categories cannot.
   */
  async deleteIdentityFile(category: "custom", filename: string): Promise<boolean> {
    if (category !== "custom") {
      throw new Error("Only custom files can be deleted");
    }

    const filePath = join(this.dataDir, category, filename);

    try {
      await Deno.remove(filePath);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }

  // ===== Memory Files =====

  /**
   * Get the file path for a memory entry.
   * Daily memories use instance-scoped filenames: YYYY-MM-DD_{instance}.md
   * Other granularities use the date directly: {date}.md
   */
  getMemoryPath(entry: { granularity: Granularity; date: string; sourceInstance?: string; slug?: string }): string {
    const { granularity, date, sourceInstance, slug } = entry;
    let filename: string;
    if (granularity === "daily" && sourceInstance) {
      filename = `${date}_${sourceInstance}.md`;
    } else if (granularity === "significant" && slug) {
      filename = `${date}_${slug}.md`;
    } else {
      filename = `${date}.md`;
    }
    return join(this.dataDir, "memories", granularity, filename);
  }

  /**
   * Read a memory file by granularity, date, and optionally instance.
   * For daily memories, instance is required to find the correct file.
   */
  async readMemory(granularity: Granularity, date: string, sourceInstance?: string): Promise<MemoryEntry | null> {
    const filePath = this.getMemoryPath({ granularity, date, sourceInstance });

    try {
      const content = await Deno.readTextFile(filePath);
      const stat = await Deno.stat(filePath);

      return {
        id: `${granularity}-${date}`,
        granularity,
        date,
        content,
        chatIds: [], // TODO: Parse from content
        sourceInstance: sourceInstance ?? "",
        version: 1,
        createdAt: stat.birthtime?.toISOString() ?? new Date().toISOString(),
        updatedAt: stat.mtime?.toISOString() ?? new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Find a memory entry by date, searching across all instance variants.
   * For daily memories, this checks for any file matching YYYY-MM-DD_*.md.
   * For other granularities, behaves the same as readMemory.
   * Returns the first match found, or null if none exists.
   */
  async findMemoryByDate(granularity: Granularity, date: string): Promise<MemoryEntry | null> {
    // First try without instance suffix (works for non-daily)
    const direct = await this.readMemory(granularity, date);
    if (direct) return direct;

    // For daily, scan the directory for any file matching the date prefix
    if (granularity === "daily") {
      const dir = join(this.dataDir, "memories", "daily");
      try {
        const prefix = `${date}_`;
        for await (const entry of Deno.readDir(dir)) {
          if (entry.isFile && entry.name.endsWith(".md") && entry.name.startsWith(prefix)) {
            const instancePart = entry.name.replace(/\.md$/, "").slice(date.length + 1);
            return await this.readMemory(granularity, date, instancePart);
          }
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }

    return null;
  }

  /**
   * List all memories of a granularity.
   * Parses instance suffix from filenames (e.g., 2026-03-20_psycheros.md).
   */
  async listMemories(granularity: Granularity): Promise<MemoryEntry[]> {
    const dir = join(this.dataDir, "memories", granularity);
    const memories: MemoryEntry[] = [];

    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith(".md")) {
          // Parse filename: YYYY-MM-DD.md or YYYY-MM-DD_instance.md
          const stem = entry.name.replace(/\.md$/, "");
          const date = stem.replace(/_\w+$/, "") || stem; // Strip instance suffix if present
          const instanceMatch = stem.match(/^(.+?)_(\w+)$/);
          const sourceInstance = instanceMatch ? instanceMatch[2] : undefined;

          const memory = await this.readMemory(granularity, date, sourceInstance);
          if (memory) {
            memories.push(memory);
          }
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    return memories.sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Write a memory entry.
   * Uses sourceInstance from the entry for daily filenames.
   */
  async writeMemory(entry: MemoryEntry): Promise<void> {
    const dir = join(this.dataDir, "memories", entry.granularity);
    await ensureDir(dir);
    const filePath = this.getMemoryPath(entry);
    await Deno.writeTextFile(filePath, entry.content);
  }

  /**
   * Archive a memory file (move to archive directory).
   */
  async archiveMemory(granularity: Granularity, date: string, sourceInstance?: string): Promise<void> {
    if (granularity !== "daily") {
      throw new Error("Only daily memories can be archived");
    }

    const sourcePath = this.getMemoryPath({ granularity, date, sourceInstance });
    const archiveDir = join(this.dataDir, "memories", "archive", "daily");
    await ensureDir(archiveDir);
    const filename = sourceInstance ? `${date}_${sourceInstance}.md` : `${date}.md`;
    const destPath = join(archiveDir, filename);

    try {
      await Deno.rename(sourcePath, destPath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  /**
   * Delete a memory file by granularity, date, and optionally instance/slug.
   * For daily memories with instance-scope, pass sourceInstance to target the correct file.
   */
  async deleteMemory(granularity: Granularity, date: string, sourceInstance?: string, slug?: string): Promise<boolean> {
    const filePath = this.getMemoryPath({ granularity, date, sourceInstance, slug });

    try {
      await Deno.stat(filePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }

    await Deno.remove(filePath);
    return true;
  }

  /**
   * Get all memory content for RAG indexing.
   */
  async getAllMemoryContent(): Promise<string[]> {
    const granularities: Granularity[] = ["daily", "weekly", "monthly", "yearly", "significant"];
    const contents: string[] = [];

    for (const granularity of granularities) {
      const memories = await this.listMemories(granularity);
      for (const memory of memories) {
        contents.push(`# ${memory.granularity} - ${memory.date}\n\n${memory.content}`);
      }
    }

    return contents;
  }
}

/**
 * File order for identity files.
 * Custom files have no predefined order (sorted alphabetically instead).
 */
const IDENTITY_FILE_ORDER: Record<"self" | "user" | "relationship", string[]> = {
  self: [
    "my_identity.md",
    "my_persona.md",
    "my_personhood.md",
    "my_wants.md",
    "my_mechanics.md",
  ],
  user: [
    "user_identity.md",
    "user_life.md",
    "user_beliefs.md",
    "user_preferences.md",
    "user_patterns.md",
    "user_notes.md",
  ],
  relationship: [
    "relationship_dynamics.md",
    "relationship_history.md",
    "relationship_notes.md",
  ],
};

/**
 * Create a file store instance.
 */
export function createFileStore(dataDir: string): FileStore {
  return new FileStore(dataDir);
}
