import crypto from 'node:crypto';
import fse from 'fs-extra';
import { globby } from 'globby';
import type { FileHashes } from '../types/index.js';

const DEFAULT_EXCLUDE_PATTERNS = ['**/node_modules/**', '**/dist/**', '**/.git/**'];

export async function computeHashes(
  sourcePath: string,
  excludePatterns: string[] = [],
): Promise<FileHashes> {
  const allExcludes = [...DEFAULT_EXCLUDE_PATTERNS, ...excludePatterns];
  const negatedExcludes = allExcludes.map((p) => `!${p}`);

  const files = await globby(['**/*', ...negatedExcludes], {
    cwd: sourcePath,
    absolute: false,
    onlyFiles: true,
  });

  const hashes: FileHashes = {};

  await Promise.all(
    files.map(async (file) => {
      const content = await fse.readFile(`${sourcePath}/${file}`);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      hashes[file] = hash;
    }),
  );

  return hashes;
}
