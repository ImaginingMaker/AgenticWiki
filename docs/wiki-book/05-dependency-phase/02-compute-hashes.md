# 5.2 文件哈希 — `compute-hashes.ts`

> 为所有源文件计算 SHA256 哈希，建立增量检测基线。

---

## 策略

对所有非忽略目录下的文件逐文件计算 SHA256 哈希值，写入 `file-hashes.json`。后续增量模式可通过对比哈希快速判断文件是否变更。

## 实现细节

```typescript
const files = await globby(["**/*", "!**/node_modules/**", "!**/dist/**", "!**/.git/**"], {
  cwd: sourcePath,
  absolute: false,
  onlyFiles: true,
});

await Promise.all(
  files.map(async (file) => {
    const content = await fse.readFile(`${sourcePath}/${file}`);
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    hashes[file] = hash;
  })
);
```

**并行批处理**：使用 `Promise.all` 并发计算所有文件的哈希，避免串行 I/O 的性能瓶颈。

## 产物

```json
// file-hashes.json
{
  "src/components/Button.tsx": "a1b2c3d4e5f6...",
  "src/utils/format.ts": "f6e5d4c3b2a1...",
  "src/hooks/useAuth.ts": "9a8b7c6d5e4f..."
}
```

---

> **上一篇**: [5.1 依赖图构建](01-build-deps.md) | **下一篇**: [5.3 优先级分配](03-file-priorities.md)
