#!/usr/bin/env python3
"""Stable PDF conversion entrypoint for SanSuo sandbox tasks.

Usage:
    python scripts/convert_to_pdf.py input_path output_path

The script only uses tools that really exist in the current environment. It
fails loudly with the real stderr instead of pretending a conversion succeeded.
"""

from __future__ import annotations

import html.parser
import importlib.util
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


class ConversionError(RuntimeError):
    pass


def has_command(name: str) -> bool:
    return shutil.which(name) is not None


def has_package(import_name: str) -> bool:
    try:
        return importlib.util.find_spec(import_name) is not None
    except (ImportError, AttributeError, ValueError):
        return False


def run_command(args: list[str], cwd: Path | None = None) -> None:
    completed = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip() or "(empty stderr)"
        stdout = completed.stdout.strip()
        detail = f"Command failed: {' '.join(args)}\nstderr: {stderr}"
        if stdout:
            detail += f"\nstdout: {stdout}"
        raise ConversionError(detail)


def ensure_output(path: Path) -> None:
    if not path.exists():
        raise ConversionError(f"Conversion failed: output file does not exist: {path}")
    if path.stat().st_size <= 0:
        raise ConversionError(f"Conversion failed: output file is empty: {path}")


def choose_office_command() -> str | None:
    if has_command("libreoffice"):
        return "libreoffice"
    if has_command("soffice"):
        return "soffice"
    return None


def convert_docx(input_path: Path, output_path: Path) -> None:
    office_cmd = choose_office_command()
    if not office_cmd:
        raise ConversionError("Missing libreoffice/soffice; cannot reliably convert docx to pdf.")

    with tempfile.TemporaryDirectory(prefix="sansuo_docx_pdf_") as tmp:
        tmp_dir = Path(tmp)
        run_command(
            [
                office_cmd,
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                str(tmp_dir),
                str(input_path),
            ]
        )
        generated = tmp_dir / f"{input_path.stem}.pdf"
        ensure_output(generated)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(generated), str(output_path))


def markdown_to_text(input_path: Path) -> str:
    return input_path.read_text(encoding="utf-8", errors="replace")


def html_to_text(input_path: Path) -> str:
    raw = input_path.read_text(encoding="utf-8", errors="replace")
    if has_package("bs4"):
        from bs4 import BeautifulSoup

        return BeautifulSoup(raw, "html.parser").get_text("\n")

    class TextExtractor(html.parser.HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.parts: list[str] = []

        def handle_data(self, data: str) -> None:
            stripped = data.strip()
            if stripped:
                self.parts.append(stripped)

    extractor = TextExtractor()
    extractor.feed(raw)
    return "\n".join(extractor.parts)


def write_basic_pdf(text: str, output_path: Path, title: str | None = None) -> None:
    if not has_package("reportlab"):
        raise ConversionError("Missing reportlab; cannot generate fallback PDF.")

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(output_path), pagesize=A4)
    styles = getSampleStyleSheet()
    story = []
    if title:
        story.append(Paragraph(title, styles["Title"]))
        story.append(Spacer(1, 12))
    for line in text.splitlines() or [""]:
        safe_line = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        story.append(Paragraph(safe_line or " ", styles["BodyText"]))
        story.append(Spacer(1, 4))
    doc.build(story)


def convert_md(input_path: Path, output_path: Path) -> None:
    if has_command("pandoc"):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        run_command(["pandoc", str(input_path), "-o", str(output_path)])
        return
    if has_package("reportlab"):
        write_basic_pdf(markdown_to_text(input_path), output_path, input_path.name)
        return
    raise ConversionError("Missing pandoc and reportlab; cannot convert md to pdf.")


def convert_txt(input_path: Path, output_path: Path) -> None:
    if not has_package("reportlab"):
        raise ConversionError("Missing reportlab; cannot convert txt to pdf.")
    text = input_path.read_text(encoding="utf-8", errors="replace")
    write_basic_pdf(text, output_path, input_path.name)


def convert_html(input_path: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if has_command("wkhtmltopdf"):
        run_command(["wkhtmltopdf", str(input_path), str(output_path)])
        return
    if has_package("weasyprint"):
        from weasyprint import HTML

        HTML(filename=str(input_path)).write_pdf(str(output_path))
        return
    if has_package("reportlab"):
        write_basic_pdf(html_to_text(input_path), output_path, input_path.name)
        return
    raise ConversionError("Missing wkhtmltopdf, weasyprint, and reportlab; cannot convert html to pdf.")


def convert(input_path: Path, output_path: Path) -> None:
    if not input_path.exists():
        raise ConversionError(f"Input file does not exist: {input_path}")
    suffix = input_path.suffix.lower()
    if output_path.suffix.lower() != ".pdf":
        raise ConversionError(f"Output path must end with .pdf: {output_path}")

    if suffix == ".docx":
        convert_docx(input_path, output_path)
    elif suffix == ".md":
        convert_md(input_path, output_path)
    elif suffix == ".txt":
        convert_txt(input_path, output_path)
    elif suffix in {".html", ".htm"}:
        convert_html(input_path, output_path)
    else:
        raise ConversionError(f"Unsupported input type: {suffix or '(no extension)'}")

    ensure_output(output_path)
    print(f"PDF generated: {output_path}")


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("Usage: python scripts/convert_to_pdf.py input_path output_path", file=sys.stderr)
        return 2

    try:
        convert(Path(argv[1]).expanduser().resolve(), Path(argv[2]).expanduser().resolve())
        return 0
    except ConversionError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"ERROR: unexpected failure: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
