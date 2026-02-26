/**
 * Identity Tools
 *
 * MCP tools for reading and writing my identity files.
 * All tools operate from my first-person perspective.
 */

import { z } from "zod";
import type { FileStore } from "../storage/mod.ts";
import type { IdentityFile } from "../types.ts";

/**
 * Schema for identity category.
 */
const IdentityCategorySchema = z.enum(["self", "user", "relationship"]);

/**
 * Input schema for identity/get_all tool.
 */
export const IdentityGetAllSchema = z.object({});

/**
 * Input schema for identity/write tool.
 */
export const IdentityWriteSchema = z.object({
  category: IdentityCategorySchema,
  filename: z.string().min(1),
  content: z.string(),
  instanceId: z.string().min(1),
});

/**
 * Output type for identity/get_all tool.
 */
export interface IdentityGetAllOutput {
  self: Array<{ filename: string; content: string }>;
  user: Array<{ filename: string; content: string }>;
  relationship: Array<{ filename: string; content: string }>;
}

/**
 * Output type for identity/write tool.
 */
export interface IdentityWriteOutput {
  success: boolean;
  message: string;
}

/**
 * Create the identity/get_all tool handler.
 */
export function createIdentityGetAllHandler(store: FileStore) {
  return async (): Promise<IdentityGetAllOutput> => {
    const identity = await store.readAllIdentity();

    return {
      self: identity.self.map((f) => ({ filename: f.filename, content: f.content })),
      user: identity.user.map((f) => ({ filename: f.filename, content: f.content })),
      relationship: identity.relationship.map((f) => ({
        filename: f.filename,
        content: f.content,
      })),
    };
  };
}

/**
 * Create the identity/write tool handler.
 */
export function createIdentityWriteHandler(store: FileStore) {
  return async (input: z.infer<typeof IdentityWriteSchema>): Promise<IdentityWriteOutput> => {
    const { category, filename, content, instanceId } = input;

    // Validate filename
    if (!filename.endsWith(".md")) {
      return {
        success: false,
        message: "Filename must end with .md",
      };
    }

    const file: IdentityFile = {
      category,
      filename,
      content,
      version: 1, // TODO: Track versions
      lastModified: new Date().toISOString(),
      modifiedBy: instanceId,
    };

    await store.writeIdentityFile(file);

    return {
      success: true,
      message: `I have updated my ${category} file: ${filename}`,
    };
  };
}

/**
 * Tool definitions for MCP registration.
 */
export const identityTools = {
  "identity/get_all": {
    description:
      "Get all my identity files (self, user, relationship). These define who I am, who I'm talking to, and our relationship.",
    inputSchema: IdentityGetAllSchema,
  },
  "identity/write": {
    description:
      "Update one of my identity files. Use this when I want to remember something about myself, the user, or our relationship.",
    inputSchema: IdentityWriteSchema,
  },
};
