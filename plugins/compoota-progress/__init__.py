"""Compoota progress bridge for Hermes.

Hermes loads this as a normal plugin. During a Compoota request the
house-server sets COMPOOTA_PROGRESS_FILE and COMPOOTA_RUN_ID. The plugin
observes Hermes lifecycle hooks and appends compact JSONL events for the
house-server to stream to the mobile app.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_LOCK = threading.Lock()
_RUN_ID = os.getenv("COMPOOTA_RUN_ID", "")
_PROGRESS_FILE = os.getenv("COMPOOTA_PROGRESS_FILE", "")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _enabled() -> bool:
    return bool(_RUN_ID and _PROGRESS_FILE)


def _summarize_tool(tool_name: str, args: Any) -> tuple[str, str]:
    if not isinstance(args, dict):
        return f"Using {tool_name}", ""

    if tool_name in {"terminal", "shell", "exec_command"}:
        command = args.get("command") or args.get("cmd") or ""
        detail = command if isinstance(command, str) else ""
        return "Running a local command", detail[:180]

    if tool_name in {"read_file", "write_file"}:
        path = args.get("path") or args.get("file") or ""
        action = "Reading a file" if tool_name == "read_file" else "Writing a file"
        return action, str(path)[:180]

    if tool_name in {"patch", "apply_patch"}:
        return "Updating files", "Applying a focused patch"

    if "web" in tool_name or "search" in tool_name:
        query = args.get("query") or args.get("q") or args.get("url") or ""
        return "Checking the web", str(query)[:180]

    clean = tool_name.replace("_", " ").replace("-", " ").strip()
    return f"Using {clean or 'a tool'}", ""


def _write(event_id: str, label: str, *, status: str = "done", detail: str = "") -> None:
    if not _enabled():
        return

    payload = {
        "id": event_id,
        "runId": _RUN_ID,
        "label": label,
        "detail": detail or None,
        "status": status,
        "at": _now(),
    }

    try:
      path = Path(_PROGRESS_FILE)
      path.parent.mkdir(parents=True, exist_ok=True)
      with _LOCK:
          with path.open("a", encoding="utf-8") as handle:
              handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    except Exception:
        # Progress should never interrupt the agent.
        return


def _tool_key(tool_name: str, tool_call_id: str) -> str:
    clean = tool_name or tool_call_id or "unknown"
    return f"compoota.tool.{clean}"


def _on_pre_llm_call(**_: Any) -> None:
    _write("compoota.model", "Thinking through the request", status="running")


def _on_post_llm_call(**_: Any) -> None:
    _write("compoota.model", "Finished a thinking pass")


def _on_pre_tool_call(
    tool_name: str = "",
    args: Any = None,
    tool_call_id: str = "",
    **_: Any,
) -> None:
    label, detail = _summarize_tool(tool_name, args)
    _write(_tool_key(tool_name, tool_call_id), label, status="running", detail=detail)


def _on_post_tool_call(
    tool_name: str = "",
    args: Any = None,
    result: Any = None,
    tool_call_id: str = "",
    **_: Any,
) -> None:
    label, detail = _summarize_tool(tool_name, args)
    if not detail and isinstance(result, str):
        detail = result.replace("\n", " ")[:180]
    _write(_tool_key(tool_name, tool_call_id), f"{label} finished", detail=detail)


def register(ctx) -> None:
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    ctx.register_hook("post_tool_call", _on_post_tool_call)
