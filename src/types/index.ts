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
/** Issue 类型 — 按影响层次分为 3 个优先级层级 */
export type IssueType =
  // 🔴 P0: 功能正确性 — 运行时崩溃/数据错误/安全漏洞
  | "bug" // 运行时错误：空值访问、错误吞没、闭包陷阱、竞态、内存泄漏
  | "security" // 安全漏洞：XSS、unsafe JSON.parse、敏感数据暴露
  // 🟡 P1: 代码健康 — 类型安全/性能债
  | "typescript" // 类型安全债：any滥用、缺接口、@ts-ignore、API未类型化
  | "performance" // 性能债：不必要渲染、大列表无虚拟化、缺少memo
  // 🟢 P2: 优化建议 — 不影响运行但影响维护
  | "dead_code" // 死代码：注释代码、未使用导入、死状态
  | "complexity" // 复杂度债：组件过长、嵌套过深、职责过多
  | "maintainability" // 可维护性债：重复代码、应抽取工具函数、Magic Number、命名不一致
  | "ux"; // 体验债：缺loading、空状态、错误反馈缺失

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

/** 产物类型 — 按需选择产出哪些类型的分析产物 */
export type ArtifactVolume = "wiki" | "issue" | "experience";

/** 所有支持的产物类型 */
export const ALL_VOLUMES: ArtifactVolume[] = ["wiki", "issue", "experience"];

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
  /** 要产出的产物类型（默认 wiki,issue,experience 全部产出） */
  volumes?: ArtifactVolume[];
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
  /** Number of times this task has been retried after verification failure. */
  retryCount?: number;
  /** Last verification error message. */
  lastError?: string;
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

// === File Task Index (G1: 增量模式兼容聚簇) ===
export interface FileTaskIndex {
  fileToTasks: Record<string, string[]>;
  taskToFiles: Record<string, string[]>;
  source: "folder-strategy" | "task-clusters";
  generatedAt: string;
}

// === Experience Pattern (通用开发经验) ===

/** Pattern category — 经验分类 */
export type ExperienceCategory =
  | "hook"         // 自定义 Hook 模式
  | "component"    // 组件组合模式
  | "state"        // 状态管理模式
  | "data-flow"    // 数据流模式
  | "error"        // 错误处理模式
  | "utility"      // 工具函数模式
  | "architecture" // 架构决策模式
  | "testing";     // 测试模式

/** 经验模式生命周期状态（增量增删改查核心） */
export type ExperiencePatternStatus =
  | "active"      // 正常活跃（≥2 个源聚簇确认）
  | "stale"       // 源聚簇代码已变更，需重验
  | "orphaned"    // 只剩 <2 个源聚簇，降级为单点实现
  | "deprecated"; // 手动废弃

export interface ExperiencePatternMeta {
  /** 经验条目唯一 ID */
  id: string;
  /** 分类 */
  category: ExperienceCategory;
  /** 生命周期状态 */
  status: ExperiencePatternStatus;
  /** 经验标题 */
  title: string;
  /** 一句话描述 */
  summary: string;
  /** 来源聚簇 ID 列表 */
  sourceClusters: string[];
  /** 来源文件列表（sourceRoot-relative） */
  sourceFiles: string[];
  /** 关联的 Wiki 章节 */
  wikiChapters: string[];
  /** stale/重新验证的原因（增量模式自动填充） */
  staleReason?: string;
  /** stale 日期（ISO 时间戳） */
  staleAt?: string;
}

/** 增量模式下受影响的经验条目 */
export interface AffectedExperience {
  id: string;
  path: string;
  category: ExperienceCategory;
  action: "stale" | "orphaned" | "unchanged";
  reason: string;
  matchedClusters: string[];
  remainingClusters: string[];
}

/** Index of all experience documents */
export interface ExperienceIndex {
  generatedAt: string;
  totalPatterns: number;
  byCategory: Record<string, ExperiencePatternMeta[]>;
  patterns: ExperiencePatternMeta[];
}
