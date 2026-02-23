const path = require("path");
const fs = require("fs");
const { remote } = require("webdriverio");

const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const CONFIG_DIR = path.join(ROOT, "configs");
const APPS_DIR = path.join(ROOT, "apps");

// Appium server defaults (server should be running already)
const APPIUM_HOST = process.env.APPIUM_HOST || "127.0.0.1";
const APPIUM_PORT = Number(process.env.APPIUM_PORT || 4723);
const DEVICE_NAME = process.env.DEVICE_NAME || "emulator-5554";

function die(msg) {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

function listConfigFiles() {
  if (!fs.existsSync(CONFIG_DIR)) die(`Missing folder: ${CONFIG_DIR}`);
  return fs
    .readdirSync(CONFIG_DIR)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .map((f) => path.join(CONFIG_DIR, f));
}

function loadConfig(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const cfg = JSON.parse(raw);

  if (!cfg.name) cfg.name = path.basename(filePath, ".json");

  if (!cfg.apk) die(`Config ${filePath} missing "apk" (e.g. "app-ipswich.apk")`);
  cfg.apkPath = path.isAbsolute(cfg.apk) ? cfg.apk : path.join(APPS_DIR, cfg.apk);
  if (!fs.existsSync(cfg.apkPath)) die(`APK not found for ${cfg.name}: ${cfg.apkPath}`);

  if (!cfg.homeIcon) die(`Config ${filePath} missing "homeIcon" (e.g. "icons/ipswich/home.png")`);
  cfg.homeIconPath = path.isAbsolute(cfg.homeIcon) ? cfg.homeIcon : path.join(ROOT, cfg.homeIcon);
  if (!fs.existsSync(cfg.homeIconPath)) die(`Icon PNG not found for ${cfg.name}: ${cfg.homeIconPath}`);

  // Defaults
  cfg.waitBeforeSearchMs = Number(cfg.waitBeforeSearchMs ?? 2000);
  cfg.imageThreshold = Number(cfg.imageThreshold ?? 0.4);
  cfg.retries = Number(cfg.retries ?? 3);
  cfg.retryDelayMs = Number(cfg.retryDelayMs ?? 1200);
  cfg.newCommandTimeout = Number(cfg.newCommandTimeout ?? 300);

  // Steps are optional; normalize to array
  if (cfg.steps != null && !Array.isArray(cfg.steps)) {
    die(`Config ${filePath} "steps" must be an array if provided`);
  }
  cfg.steps = Array.isArray(cfg.steps) ? cfg.steps : [];

  return cfg;
}

function readPngBase64(absPath) {
  return fs.readFileSync(absPath, { encoding: "base64" });
}

function resolvePathMaybeAbsolute(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

function mergeStepCfg(cfg, step) {
  // Allow step-level overrides, otherwise inherit from cfg
  return {
    waitBeforeSearchMs: Number(step.waitBeforeSearchMs ?? cfg.waitBeforeSearchMs),
    imageThreshold: Number(step.imageThreshold ?? cfg.imageThreshold),
    retries: Number(step.retries ?? cfg.retries),
    retryDelayMs: Number(step.retryDelayMs ?? cfg.retryDelayMs),

    // optional tap tuning
    tapYPercent: Number(step.tapYPercent ?? cfg.tapYPercent ?? 0.75), // tap lower by default
    tapOffsetY: Number(step.tapOffsetY ?? cfg.tapOffsetY ?? 0),
    tapOffsetX: Number(step.tapOffsetX ?? cfg.tapOffsetX ?? 0),
  };
}

/**
 * Appium Images Plugin adds the `-image` locator strategy.
 * The "selector" is the base64-encoded template PNG.
 *
 * Click by coordinates inside the matched rectangle.
 */
async function tryFindAndClickImage(driver, imageBase64, cfgLike) {
  await driver.updateSettings({ imageMatchThreshold: cfgLike.imageThreshold });

  if (cfgLike.waitBeforeSearchMs > 0) {
    await driver.pause(cfgLike.waitBeforeSearchMs);
  }

  let lastErr;
  for (let attempt = 1; attempt <= cfgLike.retries; attempt++) {
    try {
      const el = await driver.findElement("-image", imageBase64);

      const W3C_KEY = "element-6066-11e4-a52e-4f735466cecf";
      const elementId =
        (el && el[W3C_KEY]) ||
        (el && el.ELEMENT) ||
        (el && el.elementId) ||
        (typeof el === "string" ? el : null);

      if (!elementId) {
        throw new Error(`Image element returned without a valid element id. Got: ${JSON.stringify(el)}`);
      }

      const rect = await driver.getElementRect(elementId);

      const tapYPercent = typeof cfgLike.tapYPercent === "number" ? cfgLike.tapYPercent : 0.75;
      const tapOffsetX = typeof cfgLike.tapOffsetX === "number" ? cfgLike.tapOffsetX : 0;
      const tapOffsetY = typeof cfgLike.tapOffsetY === "number" ? cfgLike.tapOffsetY : 0;

      const tapX = Math.round(rect.x + rect.width / 2 + tapOffsetX);
      const tapY = Math.round(rect.y + rect.height * tapYPercent + tapOffsetY);

      await driver.performActions([
        {
          type: "pointer",
          id: "finger1",
          parameters: { pointerType: "touch" },
          actions: [
            { type: "pointerMove", duration: 0, x: tapX, y: tapY },
            { type: "pointerDown", button: 0 },
            { type: "pause", duration: 80 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ]);
      await driver.releaseActions();

      return { ok: true, attempt, rect, tapX, tapY };
    } catch (e) {
      lastErr = e;
      if (attempt < cfgLike.retries) {
        await driver.pause(cfgLike.retryDelayMs);
      }
    }
  }

  return { ok: false, attempt: cfgLike.retries, error: lastErr };
}

/**
 * NEW: Find-only (no click) for verifying screen state.
 */
async function tryFindImage(driver, imageBase64, cfgLike) {
  await driver.updateSettings({ imageMatchThreshold: cfgLike.imageThreshold });

  if (cfgLike.waitBeforeSearchMs > 0) {
    await driver.pause(cfgLike.waitBeforeSearchMs);
  }

  let lastErr;
  for (let attempt = 1; attempt <= cfgLike.retries; attempt++) {
    try {
      const el = await driver.findElement("-image", imageBase64);

      const W3C_KEY = "element-6066-11e4-a52e-4f735466cecf";
      const elementId =
        (el && el[W3C_KEY]) ||
        (el && el.ELEMENT) ||
        (el && el.elementId) ||
        (typeof el === "string" ? el : null);

      if (!elementId) {
        throw new Error(`Image element returned without a valid element id. Got: ${JSON.stringify(el)}`);
      }

      return { ok: true, attempt };
    } catch (e) {
      lastErr = e;
      if (attempt < cfgLike.retries) {
        await driver.pause(cfgLike.retryDelayMs);
      }
    }
  }

  return { ok: false, attempt: cfgLike.retries, error: lastErr };
}

function ensureArtifactsDir() {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

async function saveScreenshot(driver, filename) {
  ensureArtifactsDir();
  const base64 = await driver.takeScreenshot();
  fs.writeFileSync(filename, base64, "base64");
}

async function saveFailureScreenshot(driver, appName, stepNo) {
  try {
    const filePath = path.join(ARTIFACTS_DIR, `${appName}-step${stepNo}.png`);
    await saveScreenshot(driver, filePath);
    console.log(`Saved failure screenshot: ${filePath}`);
  } catch (e) {
    console.warn("⚠️ Failed to save screenshot:", e.message);
  }
}

async function saveAfterStepScreenshot(driver, appName, stepNo) {
  try {
    const filePath = path.join(ARTIFACTS_DIR, `${appName}-step${stepNo}-after.png`);
    await saveScreenshot(driver, filePath);
    console.log(`📸 Saved after-step screenshot: ${filePath}`);
  } catch (e) {
    console.warn("⚠️ Failed to save after-step screenshot:", e.message);
  }
}

async function runSteps(driver, cfg) {
  if (!cfg.steps.length) return { ok: true };

  for (let i = 0; i < cfg.steps.length; i++) {
    const step = cfg.steps[i];
    const stepNo = i + 1;

    if (!step || typeof step !== "object") {
      return { ok: false, error: `Step ${stepNo} is not an object` };
    }

    const type = step.type;
    if (type !== "tapImage" && type !== "assertImage") {
      return {
        ok: false,
        error: `Step ${stepNo} unsupported type "${type}" (supported: "tapImage", "assertImage")`,
      };
    }

    if (!step.png) {
      return { ok: false, error: `Step ${stepNo} missing "png"` };
    }

    const pngAbs = resolvePathMaybeAbsolute(step.png);
    if (!fs.existsSync(pngAbs)) {
      return { ok: false, error: `Step ${stepNo} PNG not found: ${pngAbs}` };
    }

    const stepCfg = mergeStepCfg(cfg, step);
    const stepBase64 = readPngBase64(pngAbs);

    console.log(
      `Step ${stepNo}/${cfg.steps.length}: ${type} ${step.png} (thr ${stepCfg.imageThreshold}, tapY% ${stepCfg.tapYPercent})`
    );

    const res =
      type === "tapImage"
        ? await tryFindAndClickImage(driver, stepBase64, stepCfg)
        : await tryFindImage(driver, stepBase64, stepCfg);

    if (!res.ok) {
      await saveFailureScreenshot(driver, cfg.name, stepNo);

      const msg = res.error?.message || String(res.error);
      return { ok: false, error: `Step ${stepNo} failed (${step.png}): ${msg}` };
    }

    // Optional: screenshot after successful step (useful for proving the UI changed)
    if (step.screenshotAfter) {
      await saveAfterStepScreenshot(driver, cfg.name, stepNo);
    }
  }

  return { ok: true };
}

async function runOneApp(cfg) {
  const homeBase64 = readPngBase64(cfg.homeIconPath);

  const caps = {
    platformName: "Android",
    "appium:automationName": "UiAutomator2",
    "appium:deviceName": DEVICE_NAME, // e.g. emulator-5554
    "appium:app": cfg.apkPath, // installs + launches the APK
    "appium:newCommandTimeout": cfg.newCommandTimeout,
    "appium:autoGrantPermissions": true,
  };

  let driver;
  const startedAt = Date.now();

  try {
    driver = await remote({
      protocol: "http",
      hostname: APPIUM_HOST,
      port: APPIUM_PORT,
      path: "/",
      logLevel: process.env.WDIO_LOG_LEVEL || "warn",
      capabilities: caps,
    });

    // 1) Click home icon
    const homeRes = await tryFindAndClickImage(driver, homeBase64, mergeStepCfg(cfg, {}));
    if (!homeRes.ok) {
      const durationMs = Date.now() - startedAt;
      return {
        name: cfg.name,
        ok: false,
        attempt: homeRes.attempt,
        threshold: cfg.imageThreshold,
        durationMs,
        error: homeRes.error?.message || String(homeRes.error),
      };
    }

    // 2) Run configured steps (if any)
    const stepsRes = await runSteps(driver, cfg);
    const durationMs = Date.now() - startedAt;

    if (stepsRes.ok) {
      return { name: cfg.name, ok: true, attempt: homeRes.attempt, threshold: cfg.imageThreshold, durationMs };
    }

    return {
      name: cfg.name,
      ok: false,
      attempt: homeRes.attempt,
      threshold: cfg.imageThreshold,
      durationMs,
      error: stepsRes.error || "Steps failed",
    };
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    return {
      name: cfg.name,
      ok: false,
      attempt: 0,
      threshold: cfg.imageThreshold,
      durationMs,
      error: e?.message || String(e),
    };
  } finally {
    try {
      if (driver) await driver.deleteSession();
    } catch (_) {
      // ignore
    }
  }
}

function printSummary(results) {
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  console.log("\n=== Visual Click Summary ===");
  console.log(`Total: ${results.length}  Passed: ${okCount}  Failed: ${failCount}\n`);

  for (const r of results) {
    const time = `${Math.round(r.durationMs / 100) / 10}s`;
    if (r.ok) {
      console.log(`${r.name}  (attempt ${r.attempt}, thr ${r.threshold}, ${time})`);
    } else {
      console.log(`${r.name}  (thr ${r.threshold}, ${time})`);
      if (r.error) console.log(`   ↳ ${r.error}`);
    }
  }

  console.log("");
}

(async () => {
  const appName = process.env.APP; 
  const configFiles = listConfigFiles();

  let targets;
  if (appName) {
    const match = configFiles.find((f) => path.basename(f, ".json") === appName);
    if (!match) {
      die(`APP=${appName} not found. Expected config file: ${path.join(CONFIG_DIR, `${appName}.json`)}`);
    }
    targets = [match];
  } else {
    targets = configFiles;
  }

  const configs = targets.map(loadConfig);

  // Run sequentially (more reliable with one emulator)
  const results = [];
  for (const cfg of configs) {
    console.log(`\n--- Running: ${cfg.name} ---`);
    results.push(await runOneApp(cfg));
  }

  printSummary(results);

  process.exit(results.some((r) => !r.ok) ? 1 : 0);
})();