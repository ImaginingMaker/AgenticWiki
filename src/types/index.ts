// AgenticWiki Type Definitions

// === Project Scan ===
export interface TechStack {
  framework: string;
  language: string;
  buildTool: string;
  packageManager: string;
  hasJSX: boolean;
  hasTypeScript: boolean;
}

export interface ProjectScanResult {
  projectPath: string;
  scannedAt: string;
  techStack: TechStack;
  sourcePath: string;
  totalFiles: number;
  totalFolders: number;
}

// === File List ===
export interface FileListResult {
  scannedAt: string;
  sourcePath: string;
  totalFiles: number;
  files: string[];
  byExtension: Record<string, number>;
}

// === Folder Strategy ===
export interface SubFolder {
  path: string;
  fileCount: number;
}

export interface FolderInfo {
  path: string;
  fileCount: number;
  logicFileCount: number;
  styleFileCount: number;
  totalTokens?: number;
  shouldSplit: boolean;
  subFolders?: SubFolder[];
  subTasks?: SubTaskInfo[];
  reason: string;
  priority: "high" | "medium" | "low";
}

export interface SubTaskInfo {
  id: string;
  label: string;
  role: string;
  files: string[];
  estimatedTokens: number;
  wikiChapter?: string;
  mergeWith?: string;
  priority: string;
}

export interface FilteredFile {
  path: string;
  reason: string;
  filterType: string;
}

export interface FolderStrategyResult {
  generatedAt: string;
  folders: FolderInfo[];
  totalFolders: number;
  foldersToAnalyze: number;
  crossFolderMerges?: CrossFolderMerge[];
}

export interface FilteredFilesResult {
  filteredAt: string;
  totalFiles: number;
  files: string[];
  filteredFiles: FilteredFile[];
  filteredCount: number;
  remainingCount: number;
}

// === Dependency Graph ===
export interface Dependency {
  resolved: string;
  type: "local" | "external";
  circular: boolean;
}

export interface ModuleInfo {
  source: string;
  dependencies: Dependency[];
  dependents: string[];
  hasCircular: boolean;
}

export interface CycleInfo {
  path: string[];
  severity: string;
  description: string;
}

export interface HotspotItem {
  source: string;
  dependentsCount?: number;
  dependenciesCount?: number;
}

export interface DependencyGraphResult {
  generatedAt: string;
  modules: ModuleInfo[];
  cycles: CycleInfo[];
  hotspots: {
    mostDepended: HotspotItem[];
    mostDependent: HotspotItem[];
  };
  mermaidGraph?: string;
}

// === Incremental Analysis ===
export interface ChangedFile {
  path: string;
  status: "modified" | "added" | "deleted";
}

export interface AffectedFile {
  path: string;
  reason: string;
}

export interface AffectedFolder {
  path: string;
  reason: string;
  files?: string[];
}

export interface AnalysisScope {
  totalFolders: number;
  affectedFolders: number;
  unaffectedFolders: number;
  reductionRatio: string;
}

export interface AffectedIssue {
  id: string;
  path: string;
  type?: string;
  severity?: string;
  reason: string;
  action: "recheck" | "stale" | "unchanged";
  matchedSourceFiles: string[];
}

export interface IncrementalAnalysisResult {
  since: string;
  sinceCommit: string;
  currentCommit: string;
  changedFiles: ChangedFile[];
  affectedFiles: AffectedFile[];
  affectedFolders: AffectedFolder[];
  unaffectedFolders: AffectedFolder[];
  affectedIssues?: AffectedIssue[];
  analysisScope?: AnalysisScope;
}

// === AST Parse ===
export interface PropInfo {
  name: string;
  type: string;
  required: boolean;
  default?: string;
}

export interface ComponentInfo {
  name: string;
  file: string;
  type: "functional" | "class";
  props: PropInfo[];
  exports: string[];
  hooks: string[];
  dependencies: string[];
  description: string;
}

export interface FunctionInfo {
  name: string;
  file: string;
  params: { name: string; type: string }[];
  returnType: string;
  isExported: boolean;
  isAsync: boolean;
}

export interface ASTParseResult {
  file: string;
  parsedAt: string;
  components: ComponentInfo[];
  functions: FunctionInfo[];
  imports: string[];
  exports: string[];
}

// === Validation ===
export interface ValidationIssue {
  id: string;
  type: string;
  severity: "error" | "warning" | "info";
  file: string;
  location: string;
  message: string;
  suggestion: string;
}

export interface ValidationReport {
  validatedAt: string;
  totalPages: number;
  issues: ValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    passed: number;
  };
}

// === Issue ===
export type IssueType =
  | "circular_dependency"
  | "dead_code"
  | "missing_types"
  | "complex_logic"
  | "inconsistent_api"
  | "potential_bug";

export type IssueSeverity = "critical" | "high" | "medium" | "low";
export type IssueStatus =
  | "detected"
  | "acknowledged"
  | "verified"
  | "fixing"
  | "fixed"
  | "verified_fixed"
  | "archived"
  | "false_positive"
  | "stale"
  | "disputed"
  | "closed";

export interface IssueLocation {
  files: string[];
  startLine?: number;
  description: string;
}

export interface VerificationRecord {
  verifiedAt: string;
  result: "fixed" | "still_exists" | "false_positive";
  details: string;
}

export interface Issue {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  status: IssueStatus;
  location: IssueLocation;
  detectedAt: string;
  detectedBy: string;
  verifiedAt: string | null;
  fixedAt: string | null;
  verificationHistory: VerificationRecord[];
  relatedWikiPages: string[];
}

// === Issue Content Validation (validate-issue-content.ts) ===
export type ContentCheckType =
  | "line_count"
  | "any_count"
  | "nesting_depth"
  | "export_references"
  | "circular_in_graph"
  | "file_exists";

export interface ContentCheck {
  issueId: string;
  issueFile: string;
  checkType: ContentCheckType;
  expected: string;
  actual: string;
  passed: boolean;
  sourceFile: string;
  detail: string;
}

export interface IssueContentValidationReport {
  validatedAt: string;
  totalChecked: number;
  checks: ContentCheck[];
  summary: {
    passed: number;
    failed: number;
    disputed: number;
  };
}

export interface IssueIndex {
  lastUpdated: string;
  issues: {
    id: string;
    type: IssueType;
    severity: IssueSeverity;
    status: IssueStatus;
    summary: string;
    files: string[];
  }[];
  stats: {
    total: number;
    bySeverity: Record<string, number>;
    byStatus: Record<string, number>;
  };
}

// === Phase ===
export type Phase =
  | "INIT"
  | "SCAN"
  | "DEPENDENCY"
  | "INCREMENTAL"
  | "GEN"
  | "ASSEMBLE"
  | "VALIDATE"
  | "FEEDBACK"
  | "DONE";

export interface SubTaskRecord {
  id: string;
  folder: string;
  status: "completed" | "failed" | "in_progress";
  output?: string;
  error?: string;
}

export interface PhaseRecord {
  phase: Phase;
  status: "completed" | "skipped" | "failed" | "in_progress";
  startedAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
  subTasks?: SubTaskRecord[];
  artifacts?: string[];
  scriptsExecuted?: { script: string; exitCode: number; duration?: string }[];
}

export interface Blocker {
  phase: Phase;
  message: string;
  timestamp: string;
  resolved: boolean;
}

export interface WikiConfig {
  mode: "full" | "incremental";
  since?: string;
  sourcePath: string;
  wikiPath: string;
  excludePatterns: string[];
  language: string;
  tokenBudgetPerSubTask?: number;
  maxRetries?: number;
  paths?: WikiPaths;
}

export interface WikiState {
  schemaVersion: number;
  id: string;
  projectPath: string;
  createdAt: string;
  currentPhase: Phase;
  phaseHistory: PhaseRecord[];
  checkpoint: {
    lastSuccessPhase: Phase | null;
    filesSnapshot: Record<string, string>;
    timestamp: string;
    retryCount?: number;
  };
  blockers: Blocker[];
  genTasks?: GenTask[];
  config: WikiConfig;
}

// === File Priority System ===
export type Priority = "P0" | "P1" | "P2" | "P3" | "P4";

export interface FilePriorityInfo {
  path: string;
  priority: Priority;
  lineCount: number;
  estimatedTokens: number;
  dependentCount: number;
  reason: string;
}

export interface FolderPriorityGroup {
  folder: string;
  totalTokens: number;
  files: FilePriorityInfo[];
}

export interface FilePrioritiesResult {
  generatedAt: string;
  folders: Record<string, FolderPriorityGroup>;
}

// === SubGraph ===
export interface SubGraph {
  folder: string;
  internalModules: ModuleInfo[];
  externalDeps: string[];
  externalDependents: string[];
}

// === GenTask ===
export interface GenTask {
  id: string;
  folder: string;
  role: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  output?: string;
  issuesFound?: string[];
  estimatedTokens: number;
  actualTokens?: number;
  mergeWith?: string;
  wikiChapter?: string;
}

// === Cross-folder Merge ===
export interface CrossFolderMerge {
  id: string;
  label: string;
  folders: string[];
  files: string[];
  estimatedTokens: number;
  wikiChapter: string;
  priority: Priority;
}

// === Symbol Index ===
export interface SymbolEntry {
  type:
    | "component"
    | "hook"
    | "function"
    | "type"
    | "interface"
    | "constant"
    | "enum";
  file: string;
  wiki: string;
  line?: number;
}

export interface SymbolIndex {
  generatedAt: string;
  symbols: Record<string, SymbolEntry>;
}

// === Wiki Paths ===
export interface WikiPaths {
  projectRoot: string;
  agenticWikiRoot: string;
  sourceRoot: string;
  wikiRoot: string;
  cacheRoot: string;
}

// === File Hash ===
export type FileHashes = Record<string, string>;
