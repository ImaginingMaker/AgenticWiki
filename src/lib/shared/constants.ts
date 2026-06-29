/**
 * Centralized configuration constants.
 *
 * All magic numbers that govern pipeline behavior live here.
 * Single source of truth → easy to tune, impossible to miss during review.
 *
 * Sections:
 *   1. Token Caps        — task size & SubAgent budget upper bounds
 *   2. Threshold Ratios   — dynamic threshold percentages
 *   3. Budget Formula     — calcTokenBudget() coefficients
 *   4. Token Estimation   — char-to-token divisor table
 *   5. Cluster Algorithm  — BFS depth, overlap, naming rules
 *   6. Scheduler          — batch control & Issue ID allocation
 *   7. System             — concurrency, locking, file I/O
 *
 * Targeted at 1M context models (DeepSeek V4, Gemini 2.5, etc.).
 */

// ============================================================================
// 1. Token Caps
// ============================================================================

/** Maximum tokens for a single task before splitting.
 *  cluster-tasks.ts (maxCluster), analyze-folders.ts (split). */
export const MAX_TASK_TOKENS = 300_000;

/** Chunk size ceiling when splitting a large task.
 *  Half of MAX_TASK_TOKENS — analyze-folders.ts (noSplit). */
export const MAX_CHUNK_TOKENS = 150_000;

/** Maximum SubAgent budget — calcTokenBudget() ceiling.
 *  gen-scheduler.ts (calcTokenBudget). */
export const MAX_SUBAGENT_BUDGET = 300_000;

/** Minimum SubAgent budget — calcTokenBudget() floor.
 *  gen-scheduler.ts (calcTokenBudget). */
export const MIN_SUBAGENT_BUDGET = 15_000;

// ============================================================================
// 2. Dynamic Threshold Ratios
// ============================================================================

/** Folder split threshold: 5% of project total.
 *  analyze-folders.ts (calcThresholds.split). */
export const SPLIT_RATIO = 0.05;
/** Folder split min/max clamp. */
export const SPLIT_MIN = 20_000;

/** Chunk size within split: 2.5% of project total.
 *  analyze-folders.ts (calcThresholds.noSplit). */
export const NO_SPLIT_RATIO = 0.025;
/** Chunk min clamp. */
export const NO_SPLIT_MIN = 10_000;

/** Cross-folder merge trigger: 0.3% of project total.
 *  analyze-folders.ts (calcThresholds.mergeMin). */
export const MERGE_MIN_RATIO = 0.003;
/** Merge min/max clamp. */
export const MERGE_MIN_MIN = 3_000;
export const MERGE_MIN_MAX = 15_000;

/** Max cluster size: 25% of project total.
 *  cluster-tasks.ts (calcClusterThresholds.maxCluster). */
export const MAX_CLUSTER_RATIO = 0.25;
/** Max cluster min clamp. */
export const MAX_CLUSTER_MIN = 1_000;

/** Min cluster size: 5% of project total.
 *  cluster-tasks.ts (calcClusterThresholds.minCluster). */
export const MIN_CLUSTER_RATIO = 0.05;
/** Min cluster min/max clamp. */
export const MIN_CLUSTER_MIN = 50;
export const MIN_CLUSTER_MAX = 15_000;

/** Project cap ratio for calcTokenBudget: 30% of project total.
 *  gen-scheduler.ts (calcTokenBudget). */
export const PROJECT_BUDGET_RATIO = 0.3;

// Default fallbacks (when project total is unavailable).
export const DEFAULT_SPLIT = 50_000;
export const DEFAULT_NO_SPLIT = 30_000;
export const DEFAULT_MERGE_MIN = 5_000;

// ============================================================================
// 3. Budget Formula (calcTokenBudget v3)
// ============================================================================

/** Token brackets for the piecewise formula. */
export const BUDGET_BRACKET_SMALL = 10_000;
export const BUDGET_BRACKET_MEDIUM = 50_000;

/** Multipliers × estimatedTokens. */
export const BUDGET_MULT_SMALL = 2.5;
export const BUDGET_MULT_MEDIUM = 2.0;
export const BUDGET_MULT_LARGE = 1.5;

/** Flat buffer added on top. */
export const BUDGET_BUFFER_SMALL = 8_000;
export const BUDGET_BUFFER_MEDIUM = 10_000;
export const BUDGET_BUFFER_LARGE = 15_000;

// ============================================================================
// 4. Token Estimation (charCount / divisor)
// ============================================================================

/** Chars-per-token divisors by file extension.
 *  Lower = denser in tokens (JSX), higher = sparser (.d.ts).
 *  file-priorities.ts / extract-file-meta.ts (estimateTokens). */
export const TOKEN_DIVISORS: Record<string, number> = {
  ".d.ts": 5.5,
  ".tsx": 3.8,
  ".jsx": 3.8,
  ".css": 5.0,
  ".scss": 5.0,
  ".less": 5.0,
  ".sass": 5.0,
  ".styl": 5.0,
};

/** Fallback divisor for unknown file types. */
export const TOKEN_DEFAULT_DIVISOR = 4.5;

// ============================================================================
// 5. Cluster Algorithm
// ============================================================================

/** A file is "shared" if imported by ≥ this many different seed clusters.
 *  cluster-tasks.ts. */
export const SHARED_IMPORT_THRESHOLD = 3;

/** Overlap ratio (Jaccard-like) to merge two clusters: intersection / min(a,b).
 *  cluster-tasks.ts (normalizeClusters). */
export const MERGE_OVERLAP_RATIO = 0.3;

/** BFS depth limit when traversing dependencies from a seed.
 *  cluster-tasks.ts. */
export const MAX_BFS_DEPTH = 2;

/** Minimum fraction of files that must live in the winning directory
 *  for majority-vote cluster naming.
 *  cluster-tasks.ts (computeClusterName). */
export const MAJORITY_NAME_RATIO = 0.3;

/** Default estimatedTokens fallback for files missing from file-meta.json.
 *  cluster-tasks.ts (fileTokens). */
export const FILE_TOKEN_FALLBACK = 1_000;

/** Directory name segments excluded from cluster naming.
 *  cluster-tasks.ts (computeClusterName). */
export const EXCLUDED_NAMING_DIRS = new Set([
  ".",
  "src",
  "common",
  "_common",
  "components",
  "_components",
  "_util",
  "hooks",
  "_hooks",
  "_example",
  "interface",
  "type",
  "types",
  "utils",
  "util",
  "shared",
  "locale",
  "style",
  "lib",
]);

// ============================================================================
// 6. Scheduler
// ============================================================================

/** Number of Issue IDs allocated per SubAgent.
 *  Actual usage rarely exceeds 5-7; gap=10 provides safe margin.
 *  gen-scheduler.ts. */
export const ISSUE_ID_GAP = 10;

/** Default batch size (number of tasks) when --limit is not specified.
 *  runner.ts (parseArgs). */
export const DEFAULT_BATCH_LIMIT = 5;

// ============================================================================
// 7. System
// ============================================================================

/** Maximum concurrent file reads to avoid EMFILE on large projects.
 *  compute-hashes.ts. */
export const MAX_CONCURRENT_READS = 50;

/** Number of bytes read from file head for regex-based meta extraction.
 *  file-priorities.ts / extract-file-meta.ts. */
export const FILE_HEAD_BYTES = 8_192;

/** State schema version — bump when state.json format changes.
 *  state-manager.ts. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Lock retry interval in milliseconds.
 *  state-manager.ts. */
export const LOCK_RETRY_MS = 100;

/** Maximum time to wait for a file lock.
 *  state-manager.ts. */
export const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
