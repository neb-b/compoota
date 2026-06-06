#!/usr/bin/env python3
"""Run a Hermes one-shot turn while writing streamed text deltas as JSONL.

The normal `hermes -z` path intentionally disables streaming so stdout stays
clean. Compoota needs both: clean final stdout for existing server behavior and
live text deltas for the mobile chat. This script keeps the final response on
stdout and writes stream events to COMPOOTA_STREAM_FILE.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import threading
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


try:
    import hermes_bootstrap  # noqa: F401
except ModuleNotFoundError:
    pass

try:
    from hermes_cli.env_loader import load_hermes_dotenv

    load_hermes_dotenv(project_env=Path.cwd() / ".env")
except Exception:
    pass

try:
    from hermes_logging import setup_logging

    setup_logging(mode="cli")
except Exception:
    pass

from hermes_cli.oneshot import (  # noqa: E402
    _create_session_db_for_oneshot,
    _normalize_toolsets,
    _oneshot_clarify_callback,
    _validate_explicit_toolsets,
)


_WRITE_LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _write_stream_event(event: dict[str, Any]) -> None:
    path = os.getenv("COMPOOTA_STREAM_FILE", "").strip()
    if not path:
        return

    payload = {**event, "at": _now()}
    try:
        stream_path = Path(path)
        stream_path.parent.mkdir(parents=True, exist_ok=True)
        with _WRITE_LOCK:
            with stream_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    except Exception:
        return


def _stream_delta(text: Optional[str]) -> None:
    if text is None:
        _write_stream_event({"type": "segment"})
        return
    if text:
        _write_stream_event({"type": "delta", "text": text})


def _run_agent(
    prompt: str,
    model: Optional[str] = None,
    provider: Optional[str] = None,
    toolsets: object = None,
    use_config_toolsets: bool = True,
) -> str:
    from hermes_cli.config import load_config
    from hermes_cli.models import detect_provider_for_model
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from hermes_cli.tools_config import _get_platform_tools
    from run_agent import AIAgent

    cfg = load_config()
    model_cfg = cfg.get("model") or {}
    if isinstance(model_cfg, str):
        cfg_model = model_cfg
    else:
        cfg_model = model_cfg.get("default") or model_cfg.get("model") or ""

    env_model = os.getenv("HERMES_INFERENCE_MODEL", "").strip()
    effective_model = (model or "").strip() or env_model or cfg_model
    effective_provider = (provider or "").strip() or None
    explicit_base_url_from_alias: Optional[str] = None

    if effective_provider is None and (model or env_model):
        explicit_model = (model or "").strip() or env_model
        if explicit_model:
            try:
                from hermes_cli import model_switch as model_switch

                model_switch._ensure_direct_aliases()
                direct = model_switch.DIRECT_ALIASES.get(explicit_model.strip().lower())
            except Exception:
                direct = None

            if direct is not None:
                effective_model = direct.model
                effective_provider = direct.provider
                if direct.base_url:
                    explicit_base_url_from_alias = direct.base_url.rstrip("/")
            else:
                cfg_provider = ""
                if isinstance(model_cfg, dict):
                    cfg_provider = str(model_cfg.get("provider") or "").strip().lower()
                current_provider = (
                    cfg_provider
                    or os.getenv("HERMES_INFERENCE_PROVIDER", "").strip().lower()
                    or "auto"
                )
                detected = detect_provider_for_model(explicit_model, current_provider)
                if detected:
                    effective_provider, effective_model = detected

    runtime = resolve_runtime_provider(
        requested=effective_provider,
        target_model=effective_model or None,
        explicit_base_url=explicit_base_url_from_alias,
    )

    toolsets_list = _normalize_toolsets(toolsets)
    if toolsets_list is None and use_config_toolsets:
        toolsets_list = sorted(_get_platform_tools(cfg, "cli"))

    agent = AIAgent(
        api_key=runtime.get("api_key"),
        base_url=runtime.get("base_url"),
        provider=runtime.get("provider"),
        api_mode=runtime.get("api_mode"),
        model=effective_model,
        enabled_toolsets=toolsets_list,
        quiet_mode=True,
        platform="cli",
        session_db=_create_session_db_for_oneshot(),
        credential_pool=runtime.get("credential_pool"),
        clarify_callback=_oneshot_clarify_callback,
        stream_delta_callback=_stream_delta,
    )
    agent.suppress_status_output = True
    agent.tool_gen_callback = None
    return agent.chat(prompt) or ""


def run_streaming_oneshot(
    prompt: str,
    model: Optional[str] = None,
    provider: Optional[str] = None,
    toolsets: object = None,
) -> int:
    logging.disable(logging.CRITICAL)

    env_model_early = os.getenv("HERMES_INFERENCE_MODEL", "").strip()
    if provider and not ((model or "").strip() or env_model_early):
        sys.stderr.write(
            "hermes-stream-jsonl: --provider requires --model "
            "(or HERMES_INFERENCE_MODEL).\n"
        )
        return 2

    explicit_toolsets, toolsets_error = _validate_explicit_toolsets(toolsets)
    if toolsets_error:
        sys.stderr.write(toolsets_error)
        return 2
    use_config_toolsets = _normalize_toolsets(toolsets) is None

    os.environ["HERMES_YOLO_MODE"] = "1"
    os.environ["HERMES_ACCEPT_HOOKS"] = "1"

    real_stdout = sys.stdout
    with open(os.devnull, "w", encoding="utf-8") as devnull:
        with redirect_stdout(devnull), redirect_stderr(devnull):
            response = _run_agent(
                prompt,
                model=model,
                provider=provider,
                toolsets=explicit_toolsets,
                use_config_toolsets=use_config_toolsets,
            )

    if response:
        real_stdout.write(response)
        if not response.endswith("\n"):
            real_stdout.write("\n")
        real_stdout.flush()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Hermes one-shot streaming bridge for compoota")
    parser.add_argument("-z", "--oneshot", required=True)
    parser.add_argument("-m", "--model")
    parser.add_argument("--provider")
    parser.add_argument("-t", "--toolsets")
    args = parser.parse_args()
    return run_streaming_oneshot(
        args.oneshot,
        model=args.model,
        provider=args.provider,
        toolsets=args.toolsets,
    )


if __name__ == "__main__":
    raise SystemExit(main())
