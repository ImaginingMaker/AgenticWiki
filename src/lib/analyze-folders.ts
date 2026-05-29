import path from "node:path";
import type {
  FileListResult,
  FolderStrategyResult,
  FolderInfo,
  SubFolder,
} from "../types/index.js";

/**
 * 入口文件名称模式（不区分大小写）
 */
const ENTRY_FILE_PATTERNS = ["app", "main", "index"];

/**
 * 判断是否为入口文件
 */
function isEntryFile(filePath: string): boolean {
  const basename = path
    .basename(filePath, path.extname(filePath))
    .toLowerCase();
  return ENTRY_FILE_PATTERNS.includes(basename);
}

/**
 * 获取文件的父文件夹路径
 */
function getParentFolder(filePath: string): string {
  return path.dirname(filePath);
}

/**
 * 分析文件夹规模，决定拆分策略
 */
export function analyzeFolders(fileList: FileListResult): FolderStrategyResult {
  // 第一步：收集所有涉及的文件夹
  const allFolders = new Set<string>();
  for (const file of fileList.files) {
    const folderPath = getParentFolder(file);
    if (folderPath) {
      allFolders.add(folderPath);
      // 添加所有父目录
      const parts = folderPath.split("/");
      for (let i = 1; i < parts.length; i++) {
        allFolders.add(parts.slice(0, i).join("/"));
      }
    }
  }

  // 第二步：统计每个文件夹下的文件
  const folderFiles = new Map<string, string[]>();
  for (const file of fileList.files) {
    const folderPath = getParentFolder(file);
    if (!folderPath) continue;

    // 文件直接所在的文件夹
    if (!folderFiles.has(folderPath)) {
      folderFiles.set(folderPath, []);
    }
    folderFiles.get(folderPath)!.push(file);
  }

  // 第三步：识别子文件夹关系
  const folderChildren = new Map<string, Set<string>>();
  for (const folder of allFolders) {
    folderChildren.set(folder, new Set<string>());
  }
  for (const folder of allFolders) {
    for (const other of allFolders) {
      if (other !== folder && other.startsWith(folder + "/")) {
        const relative = other.slice(folder.length + 1);
        if (!relative.includes("/")) {
          folderChildren.get(folder)!.add(other);
        }
      }
    }
  }

  // 第四步：构建文件夹信息
  const folders: FolderInfo[] = [];

  for (const folderPath of allFolders) {
    const files = folderFiles.get(folderPath) || [];
    const fileCount = files.length;
    const shouldSplit = fileCount > 50;

    // 统计逻辑文件和样式文件
    let logicFileCount = 0;
    let styleFileCount = 0;

    for (const file of files) {
      const ext = path.extname(file);
      if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
        logicFileCount++;
      } else if ([".vue", ".svelte"].includes(ext)) {
        logicFileCount++;
      } else if ([".css", ".scss", ".less", ".sass"].includes(ext)) {
        styleFileCount++;
      }
    }

    // 判断优先级
    const hasEntryFile = files.some(isEntryFile);
    const priority: "high" | "medium" | "low" = hasEntryFile
      ? "high"
      : "medium";

    // 构建子文件夹列表
    const subFolders: SubFolder[] = [];
    const children = folderChildren.get(folderPath);
    if (children) {
      for (const childPath of children) {
        const childFiles = folderFiles.get(childPath) || [];
        subFolders.push({
          path: childPath,
          fileCount: childFiles.length,
        });
      }
    }

    // 构建原因说明
    let reason: string;
    if (shouldSplit) {
      reason = `文件夹包含 ${fileCount} 个文件，超过阈值 50，建议拆分`;
    } else if (fileCount === 0) {
      reason = "空文件夹";
    } else {
      reason = `文件夹包含 ${fileCount} 个文件，规模适中`;
    }

    folders.push({
      path: folderPath || ".",
      fileCount,
      logicFileCount,
      styleFileCount,
      shouldSplit,
      subFolders: subFolders.length > 0 ? subFolders : undefined,
      reason,
      priority,
    });
  }

  // 按优先级和文件数排序
  folders.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.fileCount - a.fileCount;
  });

  const foldersToAnalyze = folders.filter((f) => f.fileCount > 0).length;

  return {
    generatedAt: new Date().toISOString(),
    folders,
    totalFolders: folders.length,
    foldersToAnalyze,
  };
}
