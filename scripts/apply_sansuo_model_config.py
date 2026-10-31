#!/usr/bin/env python3
"""Apply SanSuo model settings from .env to librechat.yaml.

LibreChat reliably resolves env vars for secrets such as apiKey, but model names
inside model lists are safer as concrete values. This script keeps .env as the
single place operators edit, then writes the concrete values into librechat.yaml.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
YAML_PATH = ROOT / "librechat.yaml"


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def require(values: dict[str, str], key: str) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise SystemExit(f"Missing required env var: {key}")
    return value


def replace_line_after(lines: list[str], marker: str, startswith: str, replacement: str) -> None:
    in_block = False
    for index, line in enumerate(lines):
        if marker in line:
            in_block = True
            continue
        if in_block and line.lstrip().startswith(startswith):
            indent = line[: len(line) - len(line.lstrip())]
            lines[index] = f"{indent}{replacement}"
            return
    raise SystemExit(f"Could not update line after marker {marker!r}: {startswith!r}")


def main() -> None:
    env = read_env(ENV_PATH)
    text_model = require(env, "SANSUO_TEXT_MODEL")
    vision_model = require(env, "SANSUO_VISION_MODEL")
    title_model = env.get("SANSUO_TITLE_MODEL", text_model).strip() or text_model
    base_url = require(env, "QWEN_BASE_URL")

    lines = YAML_PATH.read_text(encoding="utf-8").splitlines()

    replace_line_after(lines, "provider: 'SanSuoMain'", "model:", f"model: '{text_model}'")
    replace_line_after(lines, "name: 'SanSuoMain'", "baseURL:", f"baseURL: '{base_url}'")
    replace_line_after(lines, "name: 'SanSuoMain'", "titleModel:", f"titleModel: '{title_model}'")
    replace_line_after(lines, "endpoint: 'SanSuoMain'", "model:", f"model: '{text_model}'")

    for index, line in enumerate(lines):
        if line.strip() == "default:" and index + 2 < len(lines):
            if "models:" in lines[index - 1]:
                indent = lines[index + 1][: len(lines[index + 1]) - len(lines[index + 1].lstrip())]
                lines[index + 1] = f"{indent}- '{text_model}'"
                lines[index + 2] = f"{indent}- '{vision_model}'"
                break
    else:
        raise SystemExit("Could not update SanSuoMain model list")

    YAML_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("Applied SanSuo model config:")
    print(f"- QWEN_BASE_URL={base_url}")
    print(f"- SANSUO_TEXT_MODEL={text_model}")
    print(f"- SANSUO_VISION_MODEL={vision_model}")
    print(f"- SANSUO_TITLE_MODEL={title_model}")


if __name__ == "__main__":
    main()
