import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "./config.js";

const execFileAsync = promisify(execFile);

export async function runHermesCommand(text: string, config: Config): Promise<string> {
  if (config.hermesCommandMode === "mock") {
    return `Mock Hermes heard: ${text}`;
  }

  const envPath = [
    `${config.hermesWorkingDirectory}/venv/bin`,
    `${config.hermesWorkingDirectory}/node_modules/.bin`,
    "/home/neb/.hermes/node/bin",
    process.env.PATH ?? ""
  ]
    .filter(Boolean)
    .join(":");

  const { stdout } = await execFileAsync(
    config.hermesPythonPath,
    ["-m", "hermes_cli.main", "-z", text],
    {
      cwd: config.hermesWorkingDirectory,
      env: {
        ...process.env,
        HERMES_HOME: "/home/neb/.hermes",
        HERMES_YOLO_MODE: "1",
        HERMES_ACCEPT_HOOKS: "1",
        PATH: envPath,
        VIRTUAL_ENV: `${config.hermesWorkingDirectory}/venv`
      },
      maxBuffer: 1024 * 1024,
      timeout: config.hermesTimeoutSeconds * 1000
    }
  );

  const reply = stdout.trim();
  return reply || "Hermes finished without a text response.";
}
