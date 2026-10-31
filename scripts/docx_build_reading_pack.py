#!/usr/bin/env python3
"""Build a DOCX reading pack with text blocks and embedded image positions.

Usage:
    python scripts/docx_build_reading_pack.py input.docx [output_prefix]

The script is intentionally offline-friendly. It uses the local
`sandbox/sansuo_tools.py` helper and does not call any remote model. Feed the
extracted images to the configured VL model only when visual understanding is
needed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "sandbox"))

from sansuo_tools import docx_build_reading_pack  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract DOCX text and embedded images.")
    parser.add_argument("input_docx", help="Path to a .docx file")
    parser.add_argument("output_prefix", nargs="?", help="Output prefix; defaults to input stem")
    parser.add_argument(
        "--max-chars",
        type=int,
        default=120000,
        help="Maximum text characters to keep in the pack",
    )
    parser.add_argument(
        "--no-images",
        action="store_true",
        help="Do not copy embedded image binaries; still records image positions",
    )
    args = parser.parse_args()

    input_path = Path(args.input_docx)
    if not input_path.exists():
        print(f"Input file does not exist: {input_path}", file=sys.stderr)
        return 2
    if input_path.suffix.lower() != ".docx":
        print("Only .docx is supported by this extractor.", file=sys.stderr)
        return 2

    result = docx_build_reading_pack(
        input_path,
        output_prefix=args.output_prefix,
        max_chars=args.max_chars,
        extract_images=not args.no_images,
    )
    print("DOCX reading pack created:")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
