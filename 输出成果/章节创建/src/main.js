import { loadConfig } from "./lib/config.js";
import { loadChapterPlan } from "./lib/data-loader.js";
import { ManualBrowserExitError, isBrowserClosedError } from "./lib/graceful-browser-exit.js";
import { createLogger } from "./lib/logger.js";
import { XuexitongClient } from "./lib/xuexitong-client.js";

async function main() {
  const config = loadConfig(process.argv.slice(2));
  const logger = createLogger(config.paths.logDir);
  const chapterPlan = await loadChapterPlan(config.inputPath);

  logger.info("任务开始", {
    courseName: config.courseName,
    inputPath: config.inputPath,
    dryRun: config.dryRun,
    parentCount: chapterPlan.length
  });

  if (config.dryRun) {
    logger.info("演练模式完成，仅校验输入结构与任务规划", {
      parentTitles: chapterPlan.map((item) => item.parentTitle)
    });
    return;
  }

  const client = new XuexitongClient({ config, logger });

  try {
    await client.run(chapterPlan);
    logger.info("任务完成");
  } catch (error) {
    if (error instanceof ManualBrowserExitError || isBrowserClosedError(error) || XuexitongClient.isSafeExit(error)) {
      logger.warn("浏览器已手动关闭，脚本已安全退出");
      return;
    }
    logger.error("任务失败", {
      message: error.message
    });
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

await main();
