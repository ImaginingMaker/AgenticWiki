/**
 * Interactive Setup Wizard — 首次运行时收集用户配置偏好。
 *
 * 在 state.json 不存在时运行，引导用户配置：
 *   1. 产物类型（wiki / issue / experience）
 *   2. 每批次 SubAgent 数量（--limit）
 *   3. Token 预算模式（按数量 / 按 Token 上限）
 *
 * Usage:
 *   import { runSetupWizard } from "./setup-wizard.js";
 *   const config = await runSetupWizard(paths);
 */

import * as readline from "node:readline";
import type { ArtifactVolume } from "../../types/index.js";
import { ALL_VOLUMES } from "../../types/index.js";
import type { RunnerArgs } from "./path-resolver.js";

export interface WizardConfig {
  volumes: ArtifactVolume[];
  limit: number;
  tokenLimit?: number;
  /** true if user chose to skip customization */
  useDefaults: boolean;
}

function question(
  rl: readline.Interface,
  prompt: string,
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

async function askVolumes(
  rl: readline.Interface,
): Promise<ArtifactVolume[]> {
  console.log("");
  console.log("📦 产物类型选择");
  console.log("  可选择: wiki（代码文档）, issue（问题审查）, experience（开发经验）");
  console.log("  默认全部产出，输入逗号分隔的类型或直接回车使用默认值");
  console.log("  示例: wiki,issue  →  只要 Wiki + Issue");
  console.log("        wiki         →  只要 Wiki（最快）");
  console.log("");

  const answer = await question(rl, "  产物类型（回车 = 全部）: ");

  if (answer === "") return [...ALL_VOLUMES];

  const parts = answer.split(",").map((s) => s.trim().toLowerCase());
  const valid: ArtifactVolume[] = [];
  for (const p of parts) {
    if ((ALL_VOLUMES as string[]).includes(p)) {
      valid.push(p as ArtifactVolume);
    }
  }

  if (valid.length === 0) {
    console.log(`  ⚠️  无有效值，使用默认：${ALL_VOLUMES.join(", ")}`);
    return [...ALL_VOLUMES];
  }

  return valid;
}

async function askLimit(rl: readline.Interface): Promise<number> {
  console.log("");
  console.log("⚡ 批次调度配置");
  console.log("  每批次同时运行的 SubAgent 数量，默认 5");
  console.log("  小项目建议 3-5，中型项目 5-8，大型项目 8-15");
  console.log("");

  const answer = await question(rl, "  每批数量（回车 = 5）: ");

  if (answer === "") return 5;

  const num = parseInt(answer, 10);
  if (isNaN(num) || num < 1) {
    console.log("  ⚠️  无效值，使用默认: 5");
    return 5;
  }
  if (num > 20) {
    console.log("  ⚠️  超过最大限制 20，已调整为 20");
    return 20;
  }
  return num;
}

async function askTokenLimit(rl: readline.Interface): Promise<number | undefined> {
  console.log("");
  console.log("🎯 Token 预算（可选）");
  console.log("  按 Token 总量切分批次（如 300000），替代按数量切分");
  console.log("  回车跳过，使用数量阈值模式");
  console.log("");

  const answer = await question(rl, "  Token 上限（回车 = 跳过）: ");

  if (answer === "") return undefined;

  const num = parseInt(answer, 10);
  if (isNaN(num) || num < 10000) {
    console.log("  ⚠️  无效值，使用数量阈值模式");
    return undefined;
  }
  return num;
}

async function confirm(
  rl: readline.Interface,
  config: WizardConfig,
): Promise<boolean> {
  console.log("");
  console.log("━".repeat(40));
  console.log("📋 配置确认");
  console.log("━".repeat(40));
  const volLabel = config.volumes
    .map((v) => ({ wiki: "Wiki 代码文档", issue: "Issue 问题审查", experience: "Experience 开发经验" }[v]))
    .join("\n    ");
  console.log(`  产物类型:   ${volLabel}`);
  if (config.volumes.length < ALL_VOLUMES.length) {
    const skipped = ALL_VOLUMES.filter((v) => !config.volumes.includes(v));
    const skipLabel = skipped
      .map((v) => ({ wiki: "Wiki", issue: "Issue", experience: "Experience" }[v]))
      .join(", ");
    console.log(`  ⏭️  已跳过:   ${skipLabel}`);
  }
  console.log(`  批次策略:   ${config.tokenLimit ? `Token 上限 ${config.tokenLimit.toLocaleString()}` : `每批 ${config.limit} 个任务`}`);
  console.log("━".repeat(40));
  console.log("");

  const answer = await question(rl, "  确认开始? (Y/n) ");

  return answer === "" || answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

/**
 * Run the interactive setup wizard. Returns updated RunnerArgs.
 * If user cancels or skips, returns args unchanged (defaults applied).
 */
export async function runSetupWizard(
  args: RunnerArgs,
  projectRoot: string,
): Promise<RunnerArgs> {
  // Skip wizard if user already specified volumes or limit via CLI
  const hasCustomOptions = args.volumes || args.limit !== undefined || args.tokenLimit !== undefined;
  if (hasCustomOptions) {
    console.log("  💡 检测到 CLI 自定义参数，跳过交互向导");
    return args;
  }

  // Check if stdin is a TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    console.log("  💡 非交互式终端，使用默认配置");
    console.log("     产物: wiki, issue, experience | 每批: 5 个任务");
    console.log("     如需自定义，使用 --volumes / --limit / --token-limit");
    console.log("");
    return args;
  }

  console.log("");
  console.log("═".repeat(60));
  console.log("🎛️  AgenticWiki 项目设置向导");
  console.log("═".repeat(60));
  console.log(`  目标项目: ${projectRoot}`);
  console.log("  首次运行，配置分析选项（可直接回车使用默认值）");
  console.log("═".repeat(60));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const volumes = await askVolumes(rl);
    const limit = await askLimit(rl);
    const tokenLimit = await askTokenLimit(rl);

    const wizardConfig: WizardConfig = {
      volumes,
      limit,
      tokenLimit,
      useDefaults: false,
    };

    const confirmed = await confirm(rl, wizardConfig);

    if (!confirmed) {
      console.log("\n  🚫 已取消。可重新运行或使用默认值：");
      console.log(
        `     npx tsx src/runner.ts --project "${projectRoot}"`,
      );
      process.exit(0);
    }

    console.log("\n  ✅ 配置已确认，开始分析...\n");

    return {
      ...args,
      volumes: volumes.join(","),
      limit,
      tokenLimit,
    };
  } finally {
    rl.close();
  }
}
