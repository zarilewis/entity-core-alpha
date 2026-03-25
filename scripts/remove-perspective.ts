#!/usr/bin/env -S deno run -A
/**
 * Remove perspective references from entity-core graph files.
 * This script patches the compiled code to remove perspective field.
 */

// Files to patch
const files = [
  "./src/graph/memory-integration.ts",
  "./src/graph/store.ts",
  "./src/tools/graph.ts",
];

// Remove perspective lines and references
for (const file of files) {
  try {
    let content = Deno.readTextFileSync(file);

    // Remove perspective property declarations
    content = content.replace(/perspective\?: Perspective;\n?/g, "");
    content = content.replace(/perspective: Perspective;\n?/g, "");

    // Remove perspective from object literals
    content = content.replace(/perspective: "shared",\n?/g, "");
    content = content.replace(/perspective: input\.perspective,\n?/g, "");
    content = content.replace(/perspective: nodeInput\.perspective,\n?/g, "");
    content = content.replace(/perspective: edgeInput\.perspective,\n?/g, "");

    // Remove perspective from imports
    content = content.replace(/import type \{ Perspective \} from "\.\/types\.ts";\n?/g, "");
    content = content.replace(/import type \{ Perspective \} from "\.\.\/graph\/types\.ts";\n?/g, "");

    // Remove perspective conditionals
    content = content.replace(/if \(options\.perspective\) \{\n?\s*conditions\.push\("perspective = \?"\);\n?\s*params\.push\(options\.perspective\);\n?\s*\}\n?/g, "");
    content = content.replace(/perspective: row\.perspective as Perspective,\n?/g, "");

    Deno.writeTextFileSync(file, content);
    console.log(`Patched: ${file}`);
  } catch (e) {
    console.error(`Error patching ${file}:`, e);
  }
}

console.log("Done patching files.");
