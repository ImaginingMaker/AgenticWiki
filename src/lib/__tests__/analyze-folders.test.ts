import { describe, it, expect } from 'vitest';
import { analyzeFolders } from '../analyze-folders.js';
import type { FileListResult } from '../../types/index.js';

describe('analyzeFolders', () => {
  // 辅助函数：创建 FileListResult
  function createFileList(files: string[], sourcePath = '/fake/src'): FileListResult {
    const byExtension: Record<string, number> = {};
    for (const file of files) {
      const ext = file.match(/\.\w+$/)?.[0] || '';
      byExtension[ext] = (byExtension[ext] || 0) + 1;
    }
    return {
      scannedAt: new Date().toISOString(),
      sourcePath,
      totalFiles: files.length,
      files,
      byExtension
    };
  }

  describe('正常路径', () => {
    it('应正确分析单层文件夹结构', () => {
      const fileList = createFileList([
        'src/App.tsx',
        'src/index.ts',
        'src/utils/helper.ts',
        'src/utils/format.ts'
      ]);

      const result = analyzeFolders(fileList);

      expect(result.folders.length).toBeGreaterThan(0);
      expect(result.totalFolders).toBe(result.folders.length);
      expect(result.generatedAt).toBeTruthy();
    });

    it('应正确统计每个文件夹的文件数', () => {
      const fileList = createFileList([
        'components/Button.tsx',
        'components/Input.tsx',
        'components/Select.tsx',
        'utils/helper.ts'
      ]);

      const result = analyzeFolders(fileList);

      const componentsFolder = result.folders.find(f => f.path === 'components');
      const utilsFolder = result.folders.find(f => f.path === 'utils');

      expect(componentsFolder?.fileCount).toBe(3);
      expect(utilsFolder?.fileCount).toBe(1);
    });

    it('文件数 > 50 时 shouldSplit 应为 true', () => {
      const files = Array.from({ length: 55 }, (_, i) => `src/file${i}.ts`);
      const fileList = createFileList(files);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder?.shouldSplit).toBe(true);
      expect(srcFolder?.reason).toContain('超过阈值 50');
    });

    it('文件数 <= 50 时 shouldSplit 应为 false', () => {
      const files = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
      const fileList = createFileList(files);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder?.shouldSplit).toBe(false);
      expect(srcFolder?.reason).toContain('规模适中');
    });

    it('包含入口文件的文件夹优先级应为 high', () => {
      const fileList = createFileList([
        'src/App.tsx',
        'src/index.ts',
        'src/utils/helper.ts'
      ]);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder?.priority).toBe('high');
    });

    it('不包含入口文件的文件夹优先级应为 medium', () => {
      const fileList = createFileList([
        'components/Button.tsx',
        'components/Input.tsx'
      ]);

      const result = analyzeFolders(fileList);

      const componentsFolder = result.folders.find(f => f.path === 'components');
      expect(componentsFolder?.priority).toBe('medium');
    });

    it('应识别 Main 入口文件', () => {
      const fileList = createFileList([
        'src/Main.tsx'
      ]);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder?.priority).toBe('high');
    });

    it('应识别 Index 入口文件（不区分大小写）', () => {
      const fileList = createFileList([
        'src/INDEX.ts'
      ]);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder?.priority).toBe('high');
    });

    it('应正确统计逻辑文件和样式文件', () => {
      const fileList = createFileList([
        'src/logic.ts',
        'src/view.tsx',
        'src/style.css',
        'src/theme.scss'
      ]);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder?.logicFileCount).toBe(2); // .ts, .tsx
      expect(srcFolder?.styleFileCount).toBe(2); // .css, .scss
    });

    it('Vue 和 Svelte 文件应计入 logicFileCount', () => {
      const fileList = createFileList([
        'src/App.vue',
        'src/Widget.svelte'
      ]);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder?.logicFileCount).toBe(2);
    });

    it('应正确计算 foldersToAnalyze', () => {
      const fileList = createFileList([
        'src/App.tsx',
        'src/utils/helper.ts'
      ]);

      const result = analyzeFolders(fileList);

      // 所有有文件的文件夹都应被计入
      expect(result.foldersToAnalyze).toBe(result.folders.filter(f => f.fileCount > 0).length);
    });

    it('结果应按优先级排序（high 在前）', () => {
      const fileList = createFileList([
        'src/App.tsx',       // src 有入口文件 → high
        'utils/helper.ts'    // utils 无入口文件 → medium
      ]);

      const result = analyzeFolders(fileList);

      const highIndex = result.folders.findIndex(f => f.priority === 'high');
      const mediumIndex = result.folders.findIndex(f => f.priority === 'medium');
      expect(highIndex).toBeLessThan(mediumIndex);
    });

    it('同优先级应按文件数降序排列', () => {
      const fileList = createFileList([
        'small/a.ts',
        'big/a.ts',
        'big/b.ts',
        'big/c.ts'
      ]);

      const result = analyzeFolders(fileList);

      const bigFolder = result.folders.find(f => f.path === 'big');
      const smallFolder = result.folders.find(f => f.path === 'small');
      // 都是 medium，big 有 3 个文件，small 有 1 个
      expect(result.folders.indexOf(bigFolder!)).toBeLessThan(result.folders.indexOf(smallFolder!));
    });
  });

  describe('边界情况', () => {
    it('空文件列表应返回空结果', () => {
      const fileList = createFileList([]);

      const result = analyzeFolders(fileList);

      expect(result.folders).toEqual([]);
      expect(result.totalFolders).toBe(0);
      expect(result.foldersToAnalyze).toBe(0);
    });

    it('根目录文件应归入 "." 文件夹', () => {
      const fileList = createFileList([
        'App.tsx',
        'index.ts'
      ]);

      const result = analyzeFolders(fileList);

      const rootFolder = result.folders.find(f => f.path === '.');
      expect(rootFolder).toBeDefined();
      expect(rootFolder?.fileCount).toBe(2);
    });

    it('恰好 50 个文件时 shouldSplit 应为 false', () => {
      const files = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
      const fileList = createFileList(files);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder?.shouldSplit).toBe(false);
    });

    it('51 个文件时 shouldSplit 应为 true', () => {
      const files = Array.from({ length: 51 }, (_, i) => `src/file${i}.ts`);
      const fileList = createFileList(files);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder?.shouldSplit).toBe(true);
    });

    it('深层嵌套文件夹应正确处理', () => {
      const fileList = createFileList([
        'a/b/c/d/deep.ts'
      ]);

      const result = analyzeFolders(fileList);

      // 应该有 a, a/b, a/b/c, a/b/c/d 四个文件夹
      expect(result.folders.length).toBe(4);
    });

    it('单个文件应正确处理', () => {
      const fileList = createFileList([
        'src/index.ts'
      ]);

      const result = analyzeFolders(fileList);

      expect(result.totalFolders).toBe(1);
      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder?.fileCount).toBe(1);
      expect(srcFolder?.priority).toBe('high');
    });
  });

  describe('子文件夹识别', () => {
    it('应识别直接子文件夹', () => {
      const fileList = createFileList([
        'src/App.tsx',
        'src/components/Button.tsx',
        'src/components/Input.tsx',
        'src/utils/helper.ts'
      ]);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder?.subFolders).toBeDefined();
      expect(srcFolder?.subFolders?.length).toBe(2);

      const subPaths = srcFolder?.subFolders?.map(s => s.path) || [];
      expect(subPaths).toContain('src/components');
      expect(subPaths).toContain('src/utils');
    });

    it('无子文件夹时 subFolders 应为 undefined', () => {
      const fileList = createFileList([
        'utils/helper.ts'
      ]);

      const result = analyzeFolders(fileList);

      const utilsFolder = result.folders.find(f => f.path === 'utils');
      expect(utilsFolder?.subFolders).toBeUndefined();
    });

    it('子文件夹应包含正确的文件数', () => {
      const fileList = createFileList([
        'src/App.tsx',
        'src/components/Button.tsx',
        'src/components/Input.tsx',
        'src/components/Select.tsx'
      ]);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      const componentsSub = srcFolder?.subFolders?.find(s => s.path === 'src/components');
      expect(componentsSub?.fileCount).toBe(3);
    });
  });

  describe('返回值结构', () => {
    it('应包含 generatedAt 时间戳', () => {
      const fileList = createFileList(['src/App.tsx']);

      const result = analyzeFolders(fileList);

      expect(result.generatedAt).toBeTruthy();
      expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
    });

    it('FolderInfo 应包含所有必需字段', () => {
      const fileList = createFileList([
        'src/App.tsx',
        'src/style.css'
      ]);

      const result = analyzeFolders(fileList);

      const srcFolder = result.folders.find(f => f.path === 'src');
      expect(srcFolder).toHaveProperty('path');
      expect(srcFolder).toHaveProperty('fileCount');
      expect(srcFolder).toHaveProperty('logicFileCount');
      expect(srcFolder).toHaveProperty('styleFileCount');
      expect(srcFolder).toHaveProperty('shouldSplit');
      expect(srcFolder).toHaveProperty('reason');
      expect(srcFolder).toHaveProperty('priority');
    });
  });
});
