import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "./config.js";

const execFileAsync = promisify(execFile);

export type CommandActivity = {
  id: string;
  label: string;
  detail?: string;
  status: "done" | "error";
  at: string;
};

type CommandResult = {
  reply: string;
  activity: CommandActivity[];
};

function activity(id: string, label: string, detail?: string, status: "done" | "error" = "done"): CommandActivity {
  return {
    id,
    label,
    detail,
    status,
    at: new Date().toISOString()
  };
}

export async function runHermesCommand(text: string, config: Config): Promise<CommandResult> {
  if (config.hermesCommandMode === "mock") {
    return {
      reply: `Mock Compoota heard: ${text}`,
      activity: [
        activity("compoota.mock", "Used the local mock responder", "Private agent calls are disabled in this config.")
      ]
    };
  }

  const envPath = [
    `${config.hermesWorkingDirectory}/venv/bin`,
    `${config.hermesWorkingDirectory}/node_modules/.bin`,
    "/home/neb/.hermes/node/bin",
    process.env.PATH ?? ""
  ]
    .filter(Boolean)
    .join(":");

  const startedAt = Date.now();
  const commandActivity: CommandActivity[] = [
    activity("compoota.agent.start", "Sent the request to the local agent", "Running the private Pi agent in one-shot mode.")
  ];

  try {
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

    const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    commandActivity.push(
      activity("compoota.agent.done", "The local agent returned a reply", `Finished in ${durationSeconds}s.`)
    );

    const reply = stdout.trim();
    return {
      reply: reply || "Compoota finished without a text response.",
      activity: commandActivity
    };
  } catch (error) {
    commandActivity.push(activity("compoota.agent.error", "The local agent returned an error", undefined, "error"));
    throw error;
  }
}
