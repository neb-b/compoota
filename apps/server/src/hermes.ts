import { createReadStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";

export type CommandActivity = {
  id: string;
  label: string;
  detail?: string;
  status: "pending" | "running" | "done" | "error";
  at: string;
};

type CommandResult = {
  reply: string;
  activity: CommandActivity[];
};

type RunHermesOptions = {
  runId?: string;
  imagePaths?: string[];
  toolsets?: string[];
  timeoutSeconds?: number;
  onActivity?: (activity: CommandActivity) => void;
  onDelta?: (delta: string) => void;
};

type ProgressFileEvent = {
  id?: string;
  label?: string;
  detail?: string;
  status?: string;
  at?: string;
};

type StreamFileEvent = {
  type?: string;
  text?: string;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const streamingBridgePath = join(repoRoot, "scripts", "hermes-stream-jsonl.py");

function activity(
  id: string,
  label: string,
  detail?: string,
  status: CommandActivity["status"] = "done"
): CommandActivity {
  return {
    id,
    label,
    detail,
    status,
    at: new Date().toISOString()
  };
}

function normalizeProgressEvent(event: ProgressFileEvent): CommandActivity | null {
  if (!event.id || !event.label) {
    return null;
  }

  const status =
    event.status === "pending" || event.status === "running" || event.status === "done" || event.status === "error"
      ? event.status
      : "done";

  return {
    id: event.id,
    label: event.label,
    detail: event.detail,
    status,
    at: event.at || new Date().toISOString()
  };
}

async function drainProgressFile(
  filePath: string,
  offset: number,
  onActivity: (activity: CommandActivity) => void
): Promise<number> {
  if (!existsSync(filePath)) {
    return offset;
  }

  let nextOffset = offset;
  let buffer = "";

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: "utf8", start: offset });
    stream.on("data", (chunk) => {
      buffer += chunk;
      nextOffset += Buffer.byteLength(chunk, "utf8");
    });
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  for (const line of buffer.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const normalized = normalizeProgressEvent(JSON.parse(line) as ProgressFileEvent);
      if (normalized) {
        onActivity(normalized);
      }
    } catch {
      // Progress events are best-effort. A malformed line should never break the command.
    }
  }

  return nextOffset;
}

async function drainStreamFile(
  filePath: string,
  offset: number,
  onDelta: (delta: string) => void
): Promise<number> {
  if (!existsSync(filePath)) {
    return offset;
  }

  let nextOffset = offset;
  let buffer = "";

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: "utf8", start: offset });
    stream.on("data", (chunk) => {
      buffer += chunk;
      nextOffset += Buffer.byteLength(chunk, "utf8");
    });
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  for (const line of buffer.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as StreamFileEvent;
      if (event.type === "delta" && typeof event.text === "string" && event.text) {
        onDelta(event.text);
      }
    } catch {
      // Stream events are best-effort and should never break the command.
    }
  }

  return nextOffset;
}

export async function runHermesCommand(
  text: string,
  config: Config,
  options: RunHermesOptions = {}
): Promise<CommandResult> {
  const commandActivity: CommandActivity[] = [];
  const seenActivity = new Set<string>();

  function emit(next: CommandActivity): void {
    const dedupeKey = `${next.id}:${next.status}:${next.at}`;
    if (seenActivity.has(dedupeKey)) {
      return;
    }

    seenActivity.add(dedupeKey);
    const existingIndex = commandActivity.findIndex((item) => item.id === next.id);
    if (existingIndex >= 0) {
      commandActivity.splice(existingIndex, 1);
    }
    commandActivity.push(next);
    options.onActivity?.(next);
  }

  if (config.hermesCommandMode === "mock") {
    emit(activity("compoota.mock", "Used the local mock responder", "Private agent calls are disabled in this config."));
    options.onDelta?.(`mock compoota heard: ${text}`);
    return {
      reply: `mock compoota heard: ${text}`,
      activity: commandActivity
    };
  }

  const envPath = [
    `${config.hermesWorkingDirectory}/venv/bin`,
    `${config.hermesWorkingDirectory}/node_modules/.bin`,
    `${config.hermesHome}/node/bin`,
    process.env.PATH ?? ""
  ]
    .filter(Boolean)
    .join(":");

  const startedAt = Date.now();
  const runId = options.runId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const timeoutSeconds = options.timeoutSeconds ?? config.hermesTimeoutSeconds;
  const progressFile = join(tmpdir(), "compoota-progress", `${runId}.jsonl`);
  const streamFile = join(tmpdir(), "compoota-stream", `${runId}.jsonl`);
  mkdirSync(dirname(progressFile), { recursive: true });
  mkdirSync(dirname(streamFile), { recursive: true });
  rmSync(progressFile, { force: true });
  rmSync(streamFile, { force: true });

  emit(
    activity(
      "compoota.agent.start",
      "Sent the request to the local agent",
      "Running the private Pi agent in one-shot mode.",
      "running"
    )
  );

  let progressOffset = 0;
  let streamOffset = 0;
  const progressInterval = setInterval(() => {
    drainProgressFile(progressFile, progressOffset, emit)
      .then((nextOffset) => {
        progressOffset = nextOffset;
      })
      .catch(() => undefined);
    if (options.onDelta) {
      drainStreamFile(streamFile, streamOffset, options.onDelta)
        .then((nextOffset) => {
          streamOffset = nextOffset;
        })
        .catch(() => undefined);
    }
  }, 250);

  try {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const imageCommands = (options.imagePaths ?? []).map((imagePath) => `/image ${imagePath}`);
    const prompt = imageCommands.length > 0 ? `${imageCommands.join("\n")}\n\n${text}` : text;
    const args = options.onDelta ? [streamingBridgePath] : ["-m", "hermes_cli.main"];
    if (options.toolsets?.length) {
      args.push("-t", options.toolsets.join(","));
    }
    args.push("-z", prompt);
    const child = spawn(config.hermesPythonPath, args, {
      cwd: config.hermesWorkingDirectory,
      detached: true,
      env: {
        ...process.env,
        COMPOOTA_PROGRESS_FILE: progressFile,
        COMPOOTA_RUN_ID: runId,
        COMPOOTA_STREAM_FILE: streamFile,
        HERMES_ENABLE_PROJECT_PLUGINS: process.env.HERMES_ENABLE_PROJECT_PLUGINS ?? "1",
        HERMES_HOME: config.hermesHome,
        HERMES_YOLO_MODE: "1",
        HERMES_ACCEPT_HOOKS: "1",
        PATH: envPath,
        VIRTUAL_ENV: `${config.hermesWorkingDirectory}/venv`
      }
    });

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
          setTimeout(() => {
            try {
              process.kill(-(child.pid as number), "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }, 5_000).unref();
        } else {
          child.kill("SIGTERM");
        }
        reject(new Error(`Local agent timed out after ${timeoutSeconds}s`));
      }, timeoutSeconds * 1000);

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    progressOffset = await drainProgressFile(progressFile, progressOffset, emit);
    if (options.onDelta) {
      streamOffset = await drainStreamFile(streamFile, streamOffset, options.onDelta);
    }

    if (exitCode !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      throw new Error(stderr || `Local agent exited with code ${exitCode ?? "unknown"}`);
    }

    const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    emit(activity("compoota.agent.done", "The local agent returned a reply", `Finished in ${durationSeconds}s.`));

    const reply = Buffer.concat(stdoutChunks).toString("utf8").trim();
    return {
      reply: reply || "compoota finished without a text response.",
      activity: commandActivity
    };
  } catch (error) {
    emit(activity("compoota.agent.error", "The local agent returned an error", undefined, "error"));
    throw error;
  } finally {
    clearInterval(progressInterval);
    await drainProgressFile(progressFile, progressOffset, emit).catch(() => undefined);
    if (options.onDelta) {
      await drainStreamFile(streamFile, streamOffset, options.onDelta).catch(() => undefined);
    }
    rmSync(progressFile, { force: true });
    rmSync(streamFile, { force: true });
  }
}
