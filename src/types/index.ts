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
  shouldSplit: boolean;
  subFolders?: SubFolder[];
  reason: string;
  priority: 'high' | 'medium' | 'low';
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
}

export interface FilteredFilesResult {
  filteredAt: string;
  totalFiles: number;
  filteredFiles: FilteredFile[];
  filteredCount: number;
  remainingCount: number;
}

// === Dependency Graph ===
export interface Dependency {
  resolved: string;
  type: 'local' | 'external';
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
  status: 'modified' | 'added' | 'deleted';
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

export interface IncrementalAnalysisResult {
  since: string;
  sinceCommit: string;
  currentCommit: string;
  changedFiles: ChangedFile[];
  affectedFiles: AffectedFile[];
  affectedFolders: AffectedFolder[];
  unaffectedFolders: AffectedFolder[];
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
  type: 'functional' | 'class';
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
  severity: 'error' | 'warning' | 'info';
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
  | 'circular_dependency'
  | 'dead_code'
  | 'missing_types'
  | 'complex_logic'
  | 'inconsistent_api'
  | 'potential_bug';

export type IssueSeverity = 'high' | 'medium' | 'low';
export type IssueStatus = 'detected' | 'verified' | 'fixing' | 'fixed' | 'archived' | 'false_positive' | 'stale';

export interface IssueLocation {
  files: string[];
  startLine?: number;
  description: string;
}

export interface VerificationRecord {
  verifiedAt: string;
  result: 'fixed' | 'still_exists' | 'false_positive';
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

// === State ===
export type Phase =
  | 'INIT'
  | 'SCAN'
  | 'DEPENDENCY'
  | 'INCREMENTAL'
  | 'ANALYZE'
  | 'GENERATE'
  | 'VALIDATE'
  | 'FEEDBACK'
  | 'DONE';

export interface SubTaskRecord {
  id: string;
  folder: string;
  status: 'completed' | 'failed' | 'in_progress';
  output?: string;
  error?: string;
}

export interface PhaseRecord {
  phase: Phase;
  status: 'completed' | 'skipped' | 'failed' | 'in_progress';
  startedAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
  subTasks?: SubTaskRecord[];
}

export interface Blocker {
  phase: Phase;
  message: string;
  timestamp: string;
  resolved: boolean;
}

export interface WikiConfig {
  mode: 'full' | 'incremental';
  since?: string;
  sourcePath: string;
  wikiPath: string;
  excludePatterns: string[];
  language: string;
}

export interface WikiState {
  id: string;
  projectPath: string;
  createdAt: string;
  currentPhase: Phase;
  phaseHistory: PhaseRecord[];
  checkpoint: {
    lastSuccessPhase: Phase | null;
    filesSnapshot: Record<string, string>;
    timestamp: string;
  };
  blockers: Blocker[];
  config: WikiConfig;
}

// === File Hash ===
export type FileHashes = Record<string, string>;
