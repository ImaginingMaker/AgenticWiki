import path from 'node:path';
import type { FileListResult, FilteredFilesResult, FilteredFile } from '../types/index.js';

const STYLE_EXTENSIONS = ['.css', '.scss', '.less', '.sass', '.styl'];

const STYLED_FILENAME_PATTERNS = ['.styled.', '.styles.'];

function isStyleExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return STYLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isStyledComponentsFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return STYLED_FILENAME_PATTERNS.some((pattern) => lower.includes(pattern));
}

export async function filterStyles(fileList: FileListResult): Promise<FilteredFilesResult> {
  const filteredFiles: FilteredFile[] = [];

  for (const filePath of fileList.files) {
    if (isStyleExtension(filePath)) {
      filteredFiles.push({
        path: filePath,
        reason: `Style extension: ${path.extname(filePath)}`,
        filterType: 'pure_style',
      });
    } else if (isStyledComponentsFile(filePath)) {
      filteredFiles.push({
        path: filePath,
        reason: 'Styled-components definition file',
        filterType: 'styled_components',
      });
    }
  }

  return {
    filteredAt: new Date().toISOString(),
    totalFiles: fileList.totalFiles,
    filteredFiles,
    filteredCount: filteredFiles.length,
    remainingCount: fileList.totalFiles - filteredFiles.length,
  };
}
