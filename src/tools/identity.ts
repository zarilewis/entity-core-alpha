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
const IdentityCategorySchema = z.enum(["self", "user", "relationship", "custom"]);

/** Safe filename: alphanumeric, underscores, hyphens, must end with .md. Prevents path traversal. */
const SafeFilenameSchema = z.string().min(1).regex(/^[a-zA-Z0-9_-]+\.md$/, "Filename must be alphanumeric (with underscores/hyphens) and end with .md");

/**
 * Input schema for identity/get_all tool.
 */
export const IdentityGetAllSchema = z.object({});

/**
 * Input schema for identity/write tool.
 */
export const IdentityWriteSchema = z.object({
  category: IdentityCategorySchema,
  filename: SafeFilenameSchema,
  content: z.string(),
  instanceId: z.string().min(1),
});

/**
 * Input schema for identity_append tool.
 */
export const IdentityAppendSchema = z.object({
  category: IdentityCategorySchema,
  filename: SafeFilenameSchema,
  content: z.string(),
  reason: z.string().optional(),
  instanceId: z.string().min(1),
});

/**
 * Input schema for identity_prepend tool.
 */
export const IdentityPrependSchema = z.object({
  category: IdentityCategorySchema,
  filename: SafeFilenameSchema,
  content: z.string(),
  reason: z.string().optional(),
  instanceId: z.string().min(1),
});

/**
 * Input schema for identity_update_section tool.
 */
export const IdentityUpdateSectionSchema = z.object({
  category: IdentityCategorySchema,
  filename: SafeFilenameSchema,
  section: z.string().min(1),
  content: z.string(),
  reason: z.string().optional(),
  instanceId: z.string().min(1),
});

/**
 * Input schema for identity_delete_custom tool.
 */
export const IdentityDeleteCustomSchema = z.object({
  filename: SafeFilenameSchema,
});

/**
 * Output type for identity/get_all tool.
 */
export interface IdentityGetAllOutput {
  self: Array<{ filename: string; content: string }>;
  user: Array<{ filename: string; content: string }>;
  relationship: Array<{ filename: string; content: string }>;
  custom: Array<{ filename: string; content: string }>;
}

/**
 * Output type for identity operations.
 */
export interface IdentityOperationOutput {
  success: boolean;
  message: string;
  content?: string; // The resulting content
}

// =============================================================================
// XML Content Utilities
// =============================================================================

/**
 * Parse XML-tagged content from a file.
 * Returns the content between <tag>...</tag> or the whole content if no tags found.
 */
function parseXmlContent(content: string): {
  tag: string | null;
  innerContent: string;
} {
  const match = content.match(/<([^>]+)>([\s\S]*)<\/\1>/);
  if (match) {
    return { tag: match[1], innerContent: match[2].trim() };
  }
  return { tag: null, innerContent: content.trim() };
}

/**
 * Append content before the closing XML tag.
 */
function appendToXmlContent(
  existingContent: string,
  newContent: string,
  reason?: string
): string {
  const today = new Date().toISOString().split("T")[0];
  const { tag, innerContent } = parseXmlContent(existingContent);

  let addition = newContent.trim();
  if (reason) {
    addition = `\n\n<!-- Added ${today}: ${reason} -->\n${addition}`;
  } else {
    addition = `\n\n<!-- Added ${today} -->\n${addition}`;
  }

  if (tag) {
    return `<${tag}>\n${innerContent}${addition}\n</${tag}>\n`;
  }
  return existingContent.trim() + addition + "\n";
}

/**
 * Prepend content after the opening XML tag.
 */
function prependToXmlContent(
  existingContent: string,
  newContent: string,
  reason?: string
): string {
  const today = new Date().toISOString().split("T")[0];
  const { tag, innerContent } = parseXmlContent(existingContent);

  let addition = newContent.trim();
  if (reason) {
    addition = `<!-- Added ${today}: ${reason} -->\n${addition}\n\n`;
  } else {
    addition = `<!-- Added ${today} -->\n${addition}\n\n`;
  }

  if (tag) {
    return `<${tag}>\n${addition}${innerContent}\n</${tag}>\n`;
  }
  return addition + existingContent.trim() + "\n";
}

/**
 * Update content within a specific markdown section.
 */
function updateSection(
  existingContent: string,
  sectionName: string,
  newSectionContent: string,
  reason?: string
): { content: string; found: boolean } {
  const today = new Date().toISOString().split("T")[0];
  const { tag, innerContent } = parseXmlContent(existingContent);

  const headingPattern = new RegExp(
    `^(#{2,3})\\s*${escapeRegex(sectionName)}\\s*$`,
    "m"
  );
  const match = innerContent.match(headingPattern);

  if (!match) {
    return { content: existingContent, found: false };
  }

  const headingLevel = match[1];
  const startIndex = match.index!;
  const headingEndIndex = startIndex + match[0].length;

  // Find the next heading of same or higher level
  const nextHeadingPattern = new RegExp(`^${headingLevel}\\s+.+$`, "gm");
  let endIndex = innerContent.length;
  const remainingContent = innerContent.slice(headingEndIndex);
  const nextMatch = remainingContent.match(nextHeadingPattern);

  if (nextMatch && nextMatch.index !== undefined) {
    endIndex = headingEndIndex + nextMatch.index;
  }

  const timestampComment = reason
    ? `\n<!-- Updated ${today}: ${reason} -->`
    : `\n<!-- Updated ${today} -->`;

  const newSection = `${match[0]}${timestampComment}\n${newSectionContent.trim()}`;
  const newInnerContent =
    innerContent.slice(0, startIndex) + newSection + innerContent.slice(endIndex);

  if (tag) {
    return { content: `<${tag}>\n${newInnerContent.trim()}\n</${tag}>\n`, found: true };
  }
  return { content: newInnerContent.trim() + "\n", found: true };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =============================================================================
// Tool Handlers
// =============================================================================

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
      custom: identity.custom.map((f) => ({
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
  return async (input: z.infer<typeof IdentityWriteSchema>): Promise<IdentityOperationOutput> => {
    const { category, filename, content, instanceId } = input;

    if (!filename.endsWith(".md")) {
      return { success: false, message: "Filename must end with .md" };
    }

    const file: IdentityFile = {
      category,
      filename,
      content,
      version: 1,
      lastModified: new Date().toISOString(),
      modifiedBy: instanceId,
    };

    await store.writeIdentityFile(file);

    return {
      success: true,
      message: `I have updated my ${category} file: ${filename}`,
      content,
    };
  };
}

/**
 * Create the identity_append tool handler.
 */
export function createIdentityAppendHandler(store: FileStore) {
  return async (input: z.infer<typeof IdentityAppendSchema>): Promise<IdentityOperationOutput> => {
    const { category, filename, content, reason, instanceId } = input;

    if (!filename.endsWith(".md")) {
      return { success: false, message: "Filename must end with .md" };
    }

    // Read existing file
    const files = await store.readIdentityCategory(category);
    const existingFile = files.find((f) => f.filename === filename);

    const existingContent = existingFile?.content ?? "";
    const newContent = appendToXmlContent(existingContent, content, reason);

    const file: IdentityFile = {
      category,
      filename,
      content: newContent,
      version: (existingFile?.version ?? 0) + 1,
      lastModified: new Date().toISOString(),
      modifiedBy: instanceId,
    };

    await store.writeIdentityFile(file);

    return {
      success: true,
      message: `I have appended to my ${category} file: ${filename}`,
      content: newContent,
    };
  };
}

/**
 * Create the identity_prepend tool handler.
 */
export function createIdentityPrependHandler(store: FileStore) {
  return async (input: z.infer<typeof IdentityPrependSchema>): Promise<IdentityOperationOutput> => {
    const { category, filename, content, reason, instanceId } = input;

    if (!filename.endsWith(".md")) {
      return { success: false, message: "Filename must end with .md" };
    }

    // Read existing file
    const files = await store.readIdentityCategory(category);
    const existingFile = files.find((f) => f.filename === filename);

    const existingContent = existingFile?.content ?? "";
    const newContent = prependToXmlContent(existingContent, content, reason);

    const file: IdentityFile = {
      category,
      filename,
      content: newContent,
      version: (existingFile?.version ?? 0) + 1,
      lastModified: new Date().toISOString(),
      modifiedBy: instanceId,
    };

    await store.writeIdentityFile(file);

    return {
      success: true,
      message: `I have prepended to my ${category} file: ${filename}`,
      content: newContent,
    };
  };
}

/**
 * Create the identity_update_section tool handler.
 */
export function createIdentityUpdateSectionHandler(store: FileStore) {
  return async (
    input: z.infer<typeof IdentityUpdateSectionSchema>
  ): Promise<IdentityOperationOutput> => {
    const { category, filename, section, content, reason, instanceId } = input;

    if (!filename.endsWith(".md")) {
      return { success: false, message: "Filename must end with .md" };
    }

    // Read existing file
    const files = await store.readIdentityCategory(category);
    const existingFile = files.find((f) => f.filename === filename);

    if (!existingFile) {
      return {
        success: false,
        message: `File ${category}/${filename} not found`,
      };
    }

    const result = updateSection(existingFile.content, section, content, reason);

    if (!result.found) {
      return {
        success: false,
        message: `Section "${section}" not found in ${category}/${filename}`,
      };
    }

    const file: IdentityFile = {
      category,
      filename,
      content: result.content,
      version: existingFile.version + 1,
      lastModified: new Date().toISOString(),
      modifiedBy: instanceId,
    };

    await store.writeIdentityFile(file);

    return {
      success: true,
      message: `I have updated the "${section}" section in my ${category} file: ${filename}`,
      content: result.content,
    };
  };
}

/**
 * Create the identity_delete_custom tool handler.
 * Only custom files can be deleted.
 */
export function createIdentityDeleteCustomHandler(store: FileStore) {
  return async (input: z.infer<typeof IdentityDeleteCustomSchema>): Promise<IdentityOperationOutput> => {
    const { filename } = input;

    if (!filename.endsWith(".md")) {
      return { success: false, message: "Filename must end with .md" };
    }

    // Validate filename - no path traversal
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return { success: false, message: "Invalid filename: path separators not allowed" };
    }

    const deleted = await store.deleteIdentityFile("custom", filename);

    if (!deleted) {
      return {
        success: false,
        message: `Custom file ${filename} not found`,
      };
    }

    return {
      success: true,
      message: `I have deleted my custom file: ${filename}`,
    };
  };
}

// Legacy type alias for backward compatibility
export type IdentityWriteOutput = IdentityOperationOutput;

/**
 * Tool definitions for MCP registration.
 */
export const identityTools = {
  "identity/get_all": {
    description:
      "Get all my identity files (self, user, relationship, custom). These define who I am, who I'm talking to, and our relationship.",
    inputSchema: IdentityGetAllSchema,
  },
  "identity/write": {
    description:
      "Update one of my identity files. Use this when I want to replace an entire file.",
    inputSchema: IdentityWriteSchema,
  },
  "identity/append": {
    description:
      "Append content to one of my identity files. The content is added at the end, before the closing XML tag.",
    inputSchema: IdentityAppendSchema,
  },
  "identity/prepend": {
    description:
      "Prepend content to one of my identity files. The content is added at the beginning, after the opening XML tag.",
    inputSchema: IdentityPrependSchema,
  },
  "identity/update_section": {
    description:
      "Update a specific section in one of my identity files. The section is identified by its markdown heading.",
    inputSchema: IdentityUpdateSectionSchema,
  },
  "identity/delete_custom": {
    description:
      "Delete a custom identity file. Only custom files can be deleted; predefined files in other categories cannot.",
    inputSchema: IdentityDeleteCustomSchema,
  },
};
