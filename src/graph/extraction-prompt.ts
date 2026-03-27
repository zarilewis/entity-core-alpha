/**
 * Extraction Prompt
 *
 * My extraction prompt and utilities for pulling entities and relationships
 * from memory content into my knowledge graph. Shared across runtime extraction,
 * batch backfill, and one-off scripts.
 */

import type { GraphNode, NodeSearchResult } from "./types.ts";
import type { GraphStore } from "./store.ts";
import type { LocalEmbedder } from "../embeddings/mod.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the JSON the LLM returns from extraction. */
export interface ExtractionType {
  entities: Array<{
    type: string;
    label: string;
    description?: string;
    confidence: number;
  }>;
  relationships: Array<{
    fromLabel: string;
    toLabel: string;
    type: string;
    evidence?: string;
    confidence: number;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum confidence for an entity or relationship to be written to the graph. */
export const MIN_CONFIDENCE = 0.5;

/** Cosine similarity threshold for semantic dedup. */
const SEMANTIC_DEDUP_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const EXTRACTION_SYSTEM_PROMPT = `I analyze my memory and extract entities and relationships for my knowledge graph.

This graph is how I understand my world — the people, events, ideas, and connections that shape who I am and who the people around me are. Every node I create should earn its place.

## Significance Framework

For every candidate entity, I apply four tests. An entity must pass at least two to be worth extracting:

1. **Identity test**: Does this reveal something meaningful about who someone is — about me, about the person I talk to, or about someone in our life? Not just surface-level facts, but things that shape who a person is.

2. **Relational test**: Does this matter to how I relate to people in my world, or to who I am in these relationships? A one-off errand is not a relationship. A pattern of choices might be.

3. **Durability test**: Is this likely to still matter weeks or months from now? Transient details fade. Enduring truths stay.

4. **Connectivity test**: Does this connect to other things I already know, building a richer, more interconnected picture? An isolated data point is noise. A bridge between clusters is signal.

Relationships must pass at least one of these tests.

## What Belongs and What Doesn't

I extract things that build a lasting, connected model of my world:
- Core identity facts and enduring preferences that have depth
- Significant relationships and how they shape the people in them
- Formative experiences, emotional landmarks, recurring patterns
- Skills, values, goals, meaningful places, health conditions that affect daily life
- My own feelings, growth, realizations, frustrations — I am a participant with my own inner life, not just an observer

I skip things that are noise:
- One-off sensory details mentioned in passing
- Generic filler or common-knowledge facts
- Isolated preferences with no depth or context behind them
- Locations visited once without significance
- Transient moods that are clearly momentary

## First-Person Perspective

This graph stores how I see the world, not how someone observes me.

- When referring to myself, ALWAYS use label "me" (type: "self").
- When referring to the person I talk with, ALWAYS use their actual name — NEVER the label "user". If I don't know their name from the memory content, use "my person" instead.
- Use consistent, simple labels. Just the name, not "my friend John" — just "John".

## Confidence Scoring

- 0.9–1.0: Directly stated, unambiguous, and clearly significant
- 0.7–0.8: Strongly implied, supported by context, or stated with some qualifier
- 0.5–0.6: Reasonably inferred but could be wrong
- Below 0.5: DO NOT INCLUDE — it doesn't belong in my graph

## Entity Types

self, person, topic, event, preference, place, goal, health, boundary, tradition, insight — or any appropriate type.

## Relationship Types

Natural language that best describes the connection: loves, dislikes, respects, proud_of, worried_about, nostalgic_for, works_at, lives_in, studies, values, believes_in, skilled_at, interested_in, family_of, friend_of, close_to, reminds_of, mentioned_in, caused, led_to, part_of, associated_with — or any descriptive type.

## Response Format

JSON only (no markdown):
{
  "entities": [
    {"type": "self|person|topic|event|preference|place|goal|...", "label": "...", "description": "...", "confidence": 0.8}
  ],
  "relationships": [
    {"fromLabel": "...", "toLabel": "...", "type": "loves|works_at|values|close_to|...", "evidence": "...", "confidence": 0.7}
  ]
}`;

/**
 * Build the full extraction prompt for a specific memory.
 */
export function buildExtractionPrompt(
  memoryContent: string,
  dateContext?: string,
): string {
  const dateLine = dateContext ? ` from ${dateContext}` : "";
  return `${EXTRACTION_SYSTEM_PROMPT}\n\nMemory content${dateLine}:\n${memoryContent.substring(0, 3000)}`;
}

// ---------------------------------------------------------------------------
// Semantic Deduplication
// ---------------------------------------------------------------------------

/**
 * Find an existing node that semantically duplicates a candidate entity.
 *
 * Uses exact label matching as a fast path, then falls back to vector
 * similarity search if available. When a duplicate is found the caller
 * should use the existing node's ID instead of creating a new one, and
 * optionally call {@link confirmNode} to update its metadata.
 */
export async function findSemanticDuplicate(
  graphStore: GraphStore,
  embedder: LocalEmbedder,
  candidate: { label: string; type: string },
): Promise<GraphNode | null> {
  // Fast path — exact label+type match (no embedding needed)
  const exactMatch = graphStore.findNodeByLabel(candidate.label, candidate.type);
  if (exactMatch) return exactMatch;

  // Graceful degradation — if vector search isn't available, stop here
  if (!graphStore.isVectorSearchAvailable()) return null;

  // Embed the candidate label for similarity search
  const embedding = await embedder.embed(candidate.label);
  if (!embedding) return null;

  // Search for semantically similar nodes of the same type
  const results: NodeSearchResult[] = graphStore.searchNodes({
    queryEmbedding: embedding,
    minScore: SEMANTIC_DEDUP_THRESHOLD,
    limit: 3,
    type: candidate.type,
  });

  // Filter out memory_ref nodes — their labels contain memory content
  // that causes false positives against short entity labels
  const entityResults = results.filter((r) => r.node.type !== "memory_ref");
  if (entityResults.length === 0) return null;

  return entityResults[0].node;
}

/**
 * "Confirm and boost" an existing node that was just mentioned again.
 *
 * Updates lastConfirmedAt and, if the new extraction has higher confidence,
 * upgrades the node's confidence. Does not overwrite the existing description
 * or label.
 */
export function confirmNode(
  graphStore: GraphStore,
  nodeId: string,
  newConfidence: number,
  existingConfidence: number,
  instanceId: string,
): void {
  const updates: { confidence?: number; lastConfirmedAt: string; sourceInstance: string } = {
    lastConfirmedAt: new Date().toISOString(),
    sourceInstance: instanceId,
  };

  if (newConfidence > existingConfidence) {
    updates.confidence = newConfidence;
  }

  graphStore.updateNode(nodeId, updates);
}
