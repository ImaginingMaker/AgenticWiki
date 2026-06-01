import fs from "fs-extra";
import { describe, it, expect } from "vitest";
import { extractFileMeta } from "../extract-file-meta.js";
import type { FileListResult } from "../../types/index.js";

function makeFileList(files: string[], sourcePath?: string): FileListResult {
  return {
    scannedAt: new Date().toISOString(),
    sourcePath: sourcePath || "/tmp/test-src",
    totalFiles: files.length,
    files,
    byExtension: {},
  };
}

describe("extractFileMeta", () => {
  it("skips style files", () => {
    const result = extractFileMeta(
      makeFileList(["test.css", "test.scss", "test.less"]),
      "/tmp/does-not-exist",
    );
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("skips test files", () => {
    const result = extractFileMeta(
      makeFileList(["button.test.tsx", "button.spec.ts", "button.stories.jsx"]),
      "/tmp/does-not-exist",
    );
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("skips missing files gracefully", () => {
    const result = extractFileMeta(
      makeFileList(["src/missing.ts"]),
      "/tmp/does-not-exist",
    );
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("detects pure re-export barrel file", () => {
    const dir = "/tmp/aw-test-barrel";
    fs.mkdirpSync(dir);
    fs.writeFileSync(
      `${dir}/index.ts`,
      `export * from "./Button";\nexport * from "./Input";\n`,
    );
    const result = extractFileMeta(makeFileList(["index.ts"]), dir);
    expect(result["index.ts"]).toBeDefined();
    expect(result["index.ts"].isReexportBarrel).toBe(true);
    expect(result["index.ts"].hasJSX).toBe(false);
  });

  it("detects React component with JSX", () => {
    const dir = "/tmp/aw-test-component";
    fs.mkdirpSync(dir);
    fs.writeFileSync(
      `${dir}/Button.tsx`,
      [
        `import React from "react";\n`,
        `\n`,
        `export interface ButtonProps {\n`,
        `  label: string;\n`,
        `}\n`,
        `\n`,
        `export const Button: React.FC<ButtonProps> = ({ label }) => {\n`,
        `  return <button>{label}</button>;\n`,
        `};\n`,
      ].join(""),
    );
    const result = extractFileMeta(makeFileList(["Button.tsx"]), dir);
    expect(result["Button.tsx"]).toBeDefined();
    expect(result["Button.tsx"].hasJSX).toBe(true);
    expect(result["Button.tsx"].isReactComponent).toBe(true);
    expect(result["Button.tsx"].componentName).toBe("Button");
    expect(result["Button.tsx"].propTypeNames).toContain("ButtonProps");
    expect(result["Button.tsx"].exportNames).toContain("Button");
  });

  it("detects hooks", () => {
    const dir = "/tmp/aw-test-hooks";
    fs.mkdirpSync(dir);
    fs.writeFileSync(
      `${dir}/useAuth.ts`,
      [
        `import { useState, useEffect } from "react";\n`,
        `\n`,
        `export function useAuth() {\n`,
        `  const [user, setUser] = useState(null);\n`,
        `  useEffect(() => {}, []);\n`,
        `  return user;\n`,
        `}\n`,
      ].join(""),
    );
    const result = extractFileMeta(makeFileList(["useAuth.ts"]), dir);
    expect(result["useAuth.ts"]).toBeDefined();
    expect(result["useAuth.ts"].hookNames).toContain("useState");
    expect(result["useAuth.ts"].hookNames).toContain("useEffect");
    expect(result["useAuth.ts"].isReactComponent).toBe(false);
  });

  it("detects non-barrel file", () => {
    const dir = "/tmp/aw-test-nonbarrel";
    fs.mkdirpSync(dir);
    fs.writeFileSync(
      `${dir}/utils.ts`,
      `export function formatDate(d: Date): string {\n  return d.toISOString();\n}\n`,
    );
    const result = extractFileMeta(makeFileList(["utils.ts"]), dir);
    expect(result["utils.ts"]).toBeDefined();
    expect(result["utils.ts"].isReexportBarrel).toBe(false);
    expect(result["utils.ts"].exportNames).toContain("formatDate");
    expect(result["utils.ts"].hasJSX).toBe(false);
  });

  it("handles mixed files in one batch", () => {
    const dir = "/tmp/aw-test-mixed";
    fs.mkdirpSync(dir);
    fs.writeFileSync(`${dir}/index.ts`, `export * from "./Button";\n`);
    fs.writeFileSync(
      `${dir}/Button.tsx`,
      `export const Button = () => <button>click</button>;\n`,
    );
    fs.writeFileSync(
      `${dir}/useClick.ts`,
      `export function useClick() { return () => {}; }\n`,
    );
    fs.writeFileSync(`${dir}/style.css`, `.btn { color: red; }\n`);

    const result = extractFileMeta(
      makeFileList(["index.ts", "Button.tsx", "useClick.ts", "style.css"]),
      dir,
    );

    expect(result["index.ts"].isReexportBarrel).toBe(true);
    expect(result["Button.tsx"].isReactComponent).toBe(true);
    expect(result["useClick.ts"].isReactComponent).toBe(false);
    expect(result["useClick.ts"].topLevelFunctionNames).toContain("useClick");
    expect(result["style.css"]).toBeUndefined();
  });
});
