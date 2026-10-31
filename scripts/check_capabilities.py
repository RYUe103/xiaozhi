#!/usr/bin/env python3
"""Detect real sandbox conversion capabilities.

This script intentionally probes the current environment instead of trusting
prompts or assumptions. It writes capabilities.json at the project root and
prints a compact report for humans.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = PROJECT_ROOT / "capabilities.json"

COMMANDS = ["libreoffice", "soffice", "pandoc", "wkhtmltopdf"]
PYTHON_PACKAGES = {
    "reportlab": "reportlab",
    "pypdf": "pypdf",
    "PyPDF2": "PyPDF2",
    "python-docx": "docx",
    "markdown": "markdown",
    "bs4": "bs4",
    "weasyprint": "weasyprint",
}


def has_command(name: str) -> bool:
    return shutil.which(name) is not None


def has_python_package(import_name: str) -> bool:
    try:
        return importlib.util.find_spec(import_name) is not None
    except (ImportError, AttributeError, ValueError):
        return False


def main() -> int:
    capabilities = {
        "commands": {name: has_command(name) for name in COMMANDS},
        "python_packages": {
            display_name: has_python_package(import_name)
            for display_name, import_name in PYTHON_PACKAGES.items()
        },
    }

    OUTPUT_PATH.write_text(
        json.dumps(capabilities, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("Sandbox capability report")
    print(f"- wrote: {OUTPUT_PATH}")
    print("- commands:")
    for name, available in capabilities["commands"].items():
        print(f"  - {name}: {'yes' if available else 'no'}")
    print("- python packages:")
    for name, available in capabilities["python_packages"].items():
        print(f"  - {name}: {'yes' if available else 'no'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
