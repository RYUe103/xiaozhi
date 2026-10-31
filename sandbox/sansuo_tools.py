import csv
import json
import os
import re
import shutil
import subprocess
import textwrap
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

SONGTI_FONT = os.environ.get("SANSUO_FONT_SONGTI", "/mnt/fonts/Songti.ttc")
TIMES_FONT = os.environ.get("SANSUO_FONT_TIMES", "/mnt/fonts/TimesNewRoman.ttf")
CJK_FONT_NAME = "Songti"
LATIN_FONT_NAME = "TimesNewRoman"
CJK_FONT_FALLBACKS = [
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
]
LATIN_FONT_FALLBACKS = [
    "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
]


def _as_path(path):
    return Path(path).expanduser()


def _display_path(path):
    path = Path(path)
    try:
        return str(path.resolve().relative_to(Path.cwd().resolve()))
    except Exception:
        return str(path)


def _ensure_parent(path):
    _as_path(path).parent.mkdir(parents=True, exist_ok=True)


_CJK_TEXT_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def _contains_cjk(value):
    return isinstance(value, str) and bool(_CJK_TEXT_RE.search(value))


def _office_font_name(value=""):
    return "宋体" if _contains_cjk(str(value)) else "Times New Roman"


def _is_empty_docx_value(value):
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, dict)):
        return len(value) == 0
    return False


def _looks_like_markdown_heading(line):
    return bool(re.match(r"^\s{0,3}#{1,3}\s+\S", str(line)))


def _markdown_heading_level(line):
    match = re.match(r"^\s{0,3}(#{1,3})\s+(.+?)\s*$", str(line))
    if not match:
        return None, str(line).strip()
    return len(match.group(1)), match.group(2).strip()


def _strip_markdown_inline(value):
    text = str(value)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    return text.strip()


def _is_markdown_table_row(line):
    stripped = str(line).strip()
    return stripped.startswith("|") and stripped.endswith("|") and stripped.count("|") >= 2


def _is_markdown_table_separator(line):
    cells = [cell.strip() for cell in str(line).strip().strip("|").split("|")]
    return bool(cells) and all(re.match(r"^:?-{3,}:?$", cell or "") for cell in cells)


def _parse_markdown_table(rows):
    parsed = []
    for line in rows:
        cells = [_strip_markdown_inline(cell) for cell in str(line).strip().strip("|").split("|")]
        parsed.append(cells)
    if len(parsed) >= 2 and _is_markdown_table_separator(rows[1]):
        parsed.pop(1)
    width = max((len(row) for row in parsed), default=0)
    return [row + [""] * (width - len(row)) for row in parsed]


def _looks_like_docx_filename(value):
    return isinstance(value, (str, os.PathLike)) and str(value).lower().strip().endswith(".docx")


def _looks_like_pdf_filename(value):
    return isinstance(value, (str, os.PathLike)) and str(value).lower().strip().endswith(".pdf")


def _looks_like_chinese_section_heading(line):
    text = _strip_markdown_inline(line)
    if len(text) > 42:
        return False
    return bool(
        re.match(r"^[一二三四五六七八九十]+[、.．]\s*\S+", text)
        or re.match(r"^（[一二三四五六七八九十]+）\s*\S+", text)
        or re.match(r"^\([一二三四五六七八九十]+\)\s*\S+", text)
    )


TOOL_REFERENCES = {
    "create_docx": """create_docx(text, output="文件.docx", title=None, **formatting)
Generate a Word .docx file. Use for Word reports, plans, summaries, and formatted documents.
text may be str, dict, list, or markdown-ish text. Dict keys become headings; markdown tables become Word tables.
Default Word style: document title centered; section headings left-aligned; black text without
underlines or heading bottom borders; Chinese in 宋体 and Latin text/numbers in Times New Roman.
Optional formatting: alignment/paragraph_alignment, title_alignment, heading_alignment, line_spacing,
space_before_pt, space_after_pt, first_line_indent_chars, left_indent_cm, right_indent_cm,
font_name/latin_font/cjk_font, title_font_name/title_latin_font/title_cjk_font,
heading_font_name/heading_latin_font/heading_cjk_font, font_size, title_font_size,
heading_font_size, font_color, title_font_color, heading_font_color, underline,
title_underline, heading_underline, bold, title_bold, heading_bold, table_alignment and
table_vertical_alignment. Only pass overrides the user explicitly requested.
Correct:
    from sansuo_tools import create_docx
    create_docx({"策划书": "", "一、背景": "正文"}, output="策划书.docx")
    create_docx("一、背景\\n正文", output="策划书.docx", title="策划书")
Avoid hand-writing python-docx unless the user asks for complex custom layout.""",
    "read_file_auto": """read_file_auto(path)
Automatically read supported files by extension: txt/md/csv/json/pdf/docx/xlsx/pptx/doc/xls.
Use first when the user uploads a file and asks to read, summarize, inspect, or answer questions about it.
Correct:
    from sansuo_tools import read_file_auto
    text = read_file_auto("上传文件.pdf")
    print(text[:4000])""",
    "read_xlsx": """read_xlsx(path, max_rows=200, include_metadata=True)
Read Excel .xlsx with sheet names, rows, metadata, formulas, merged cells, hidden rows/columns, images/charts counts.
Use when the user asks about spreadsheet content; do not rely only on short attachment summaries.
Correct:
    from sansuo_tools import read_xlsx
    data = read_xlsx("表格.xlsx", max_rows=500)
    print(data["_metadata"])""",
    "read_pdf": """read_pdf(path, max_chars=120000)
Extract text from known text-based PDFs only. For uploaded PDFs, use read_pdf_smart first.
Correct:
    from sansuo_tools import read_pdf
    text = read_pdf("文件.pdf")
    print(text[:4000])""",
    "read_pdf_smart": """read_pdf_smart(input_pdf, output_prefix=None, batch_pages=10)
Primary uploaded-PDF helper. In this deployment it uses MinerU first whenever MinerU is configured, then falls back to pdf_build_reading_pack only if MinerU is unavailable or fails.
Use this as the first choice for uploaded PDFs.
Correct:
    from sansuo_tools import read_pdf_smart
    pack = read_pdf_smart("文件.pdf", "文件_smart")
    print(pack["route"], pack["primary_result"])
Use pack["preview_text"] for the immediate answer. For detail questions, use read_pdf_find(pack, query).""",
    "read_pdf_find": """read_pdf_find(source, query, top_k=6, neighbors=1)
Find relevant chunks for a detail question. source may be a read_pdf_smart manifest dict, a manifest JSON path, or a chunks JSONL path.
It returns matched chunks plus neighboring chunks and page/chunk metadata. Use for long PDF detail Q&A.
Correct:
    from sansuo_tools import read_pdf_smart, read_pdf_find
    pack = read_pdf_smart("文件.pdf", "文件_smart")
    hits = read_pdf_find(pack, "付款 条款 发票", top_k=5, neighbors=1)
    print(hits["context_text"])""",
    "docx_build_reading_pack": """docx_build_reading_pack(input_docx, output_prefix=None, max_chars=120000, extract_images=True)
Create a DOCX reading pack with text blocks, embedded images, image positions, and nearby before/after text.
Use for Word documents with screenshots, diagrams, charts, or embedded images.
Correct:
    from sansuo_tools import docx_build_reading_pack
    pack = docx_build_reading_pack("文件.docx", "文件_visual")
    print(pack)""",
    "pdf_build_reading_pack": """pdf_build_reading_pack(input_pdf, output_prefix=None, max_pages=None, render_visual_pages=False)
Fallback PDF reading pack: profile, page text/tables/image counts, chunks, and optional rendered page images.
Direct calls redirect to MinerU first when MinerU is configured.
Correct:
    from sansuo_tools import pdf_build_reading_pack
    pack = pdf_build_reading_pack("文件.pdf", "文件_pdf", render_visual_pages=True)
    print(pack)""",
    "mineru_parse_pdf": """mineru_parse_pdf(input_pdf, output_prefix=None, return_content_list=True, return_images=False)
Parse scanned or complex PDFs with the optional internal MinerU API.
Requires SANSUO_MINERU_PDF_PARSE_URL or SANSUO_MINERU_BASE_URL.
Correct:
    from sansuo_tools import mineru_parse_pdf
    pack = mineru_parse_pdf("扫描件.pdf", "扫描件_mineru")
    print(pack["md_path"], pack["chunks_path"])""",
    "ocr_pdf": """ocr_pdf(input_pdf, output_txt="ocr.txt", lang="chi_sim+eng", dpi=220)
OCR a scanned PDF into text when normal text extraction is empty or insufficient.
Use only for scanned PDFs or image-only pages; for normal PDFs use read_pdf/pdf_build_reading_pack first.
Correct:
    from sansuo_tools import ocr_pdf
    text = ocr_pdf("扫描件.pdf", output_txt="扫描件_ocr.txt")
    print(text[:4000])""",
    "convert_office_to_pdf": """convert_office_to_pdf(input_path, output_dir=".", timeout=180)
Convert Office files to PDF using LibreOffice while preserving layout. Use for doc/docx/xls/xlsx/ppt/pptx/rtf/odt/ods/odp.
For simple one-call conversion, convert_to_pdf(input_path, output) is also available.
Correct:
    from sansuo_tools import convert_office_to_pdf
    pdf = convert_office_to_pdf("文件.docx")
    print(pdf)""",
    "create_pdf": """create_pdf(text, output="文件.pdf", title=None)
Generate a simple text PDF directly. Correct order is body text first, output filename second, optional title third.
Correct:
    from sansuo_tools import create_pdf
    create_pdf("一、活动背景\\n正文内容", output="策划书.pdf", title="篮球活动策划书")
Avoid:
    create_pdf(title, content, "策划书.pdf")
    create_pdf(title, "策划书.pdf", content)
For formal documents, prefer create_docx(...) then convert_to_pdf(...).""",
}


def tool_reference(name=None):
    """Return short usage guidance for common sansuo_tools helpers."""
    if name is None:
        return "\n\n".join(f"## {key}\n{value}" for key, value in TOOL_REFERENCES.items())
    query = str(name).strip().lower()
    matches = [
        (key, value)
        for key, value in TOOL_REFERENCES.items()
        if query in key.lower() or query in value.lower()
    ]
    if not matches:
        return "No matching common tool. See TOOL_REFERENCE.md for the full reference."
    return "\n\n".join(f"## {key}\n{value}" for key, value in matches)


def _run(cmd, timeout=120):
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(
            "Command failed: "
            + " ".join(map(str, cmd))
            + "\nSTDOUT:\n"
            + result.stdout
            + "\nSTDERR:\n"
            + result.stderr
        )
    return result.stdout


def _run_completed(cmd, timeout=120):
    """Run a command and return the completed process for detailed diagnostics."""
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def _require_binary(*names):
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    raise RuntimeError(f"Required command not found: {' or '.join(names)}")


def _has_binary(*names):
    return any(shutil.which(name) for name in names)


def write_text(path, content, encoding="utf-8"):
    _ensure_parent(path)
    Path(path).write_text(str(content), encoding=encoding)
    return str(path)


def read_text(path, encoding="utf-8", max_chars=120000):
    text = Path(path).read_text(encoding=encoding, errors="ignore")
    return text[:max_chars]


def _register_reportlab_fonts():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfbase.ttfonts import TTFont

    cjk_font_name = CJK_FONT_NAME
    cjk_path = next((p for p in [SONGTI_FONT, *CJK_FONT_FALLBACKS] if Path(p).exists()), None)
    latin_path = next((p for p in [TIMES_FONT, *LATIN_FONT_FALLBACKS] if Path(p).exists()), None)
    if cjk_path and CJK_FONT_NAME not in pdfmetrics.getRegisteredFontNames():
        try:
            pdfmetrics.registerFont(TTFont(CJK_FONT_NAME, cjk_path, subfontIndex=0))
        except Exception:
            cjk_font_name = "STSong-Light"
    if CJK_FONT_NAME not in pdfmetrics.getRegisteredFontNames():
        try:
            pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
            cjk_font_name = "STSong-Light"
        except Exception:
            cjk_font_name = "Helvetica"
    if latin_path and LATIN_FONT_NAME not in pdfmetrics.getRegisteredFontNames():
        try:
            pdfmetrics.registerFont(TTFont(LATIN_FONT_NAME, latin_path))
        except Exception:
            pass
    latin_font_name = LATIN_FONT_NAME if LATIN_FONT_NAME in pdfmetrics.getRegisteredFontNames() else "Times-Roman"
    return cjk_font_name, latin_font_name


def _available_font_paths():
    cjk_path = next((p for p in [SONGTI_FONT, *CJK_FONT_FALLBACKS] if p and Path(p).exists()), None)
    latin_path = next((p for p in [TIMES_FONT, *LATIN_FONT_FALLBACKS] if p and Path(p).exists()), None)
    return cjk_path, latin_path


def _prepare_office_fonts():
    """Expose SanSuo fonts to tools that use fontconfig, such as LibreOffice."""
    cjk_path, latin_path = _available_font_paths()
    font_dir = Path.home() / ".local" / "share" / "fonts" / "sansuo"
    try:
        font_dir.mkdir(parents=True, exist_ok=True)
        if cjk_path:
            shutil.copyfile(cjk_path, font_dir / "Songti.ttc")
        if latin_path:
            shutil.copyfile(latin_path, font_dir / "TimesNewRoman.ttf")
        if _has_binary("fc-cache"):
            _run_completed(["fc-cache", "-f", str(font_dir)], timeout=30)
    except Exception:
        pass
    return str(font_dir)


def _pdf_font_runs(text, cjk_font, latin_font):
    runs = []
    current_font = None
    current_text = []
    for char in str(text):
        font = cjk_font if _contains_cjk(char) else latin_font
        if current_font is None:
            current_font = font
        if font != current_font:
            runs.append((current_font, "".join(current_text)))
            current_font = font
            current_text = [char]
        else:
            current_text.append(char)
    if current_text:
        runs.append((current_font, "".join(current_text)))
    return runs or [(latin_font, "")]


def _pdf_mixed_text_width(canvas_obj, text, cjk_font, latin_font, font_size):
    return sum(
        canvas_obj.stringWidth(segment, font, font_size)
        for font, segment in _pdf_font_runs(text, cjk_font, latin_font)
    )


def _pdf_draw_mixed_string(canvas_obj, x, y, text, cjk_font, latin_font, font_size, align="left"):
    if align == "center":
        x -= _pdf_mixed_text_width(canvas_obj, text, cjk_font, latin_font, font_size) / 2
    elif align == "right":
        x -= _pdf_mixed_text_width(canvas_obj, text, cjk_font, latin_font, font_size)
    for font, segment in _pdf_font_runs(text, cjk_font, latin_font):
        canvas_obj.setFont(font, font_size)
        canvas_obj.drawString(x, y, segment)
        x += canvas_obj.stringWidth(segment, font, font_size)


def create_pdf(text, output="output.pdf", title=None, font_size=16, margin=72):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    # Accept common model mistakes:
    # create_pdf(title, content, "file.pdf") and create_pdf(title, "file.pdf", content).
    if _looks_like_pdf_filename(title) and not _looks_like_pdf_filename(output):
        doc_title = text
        text = output
        output = title
        title = doc_title
    elif _looks_like_pdf_filename(output) and isinstance(title, str) and ("\n" in title or len(title) > 120):
        doc_title = text
        text = title
        title = doc_title

    cjk_font, latin_font = _register_reportlab_fonts()
    _ensure_parent(output)
    c = canvas.Canvas(str(output), pagesize=A4)
    width, height = A4
    y = height - margin

    if title:
        _pdf_draw_mixed_string(c, width / 2, y, str(title), cjk_font, latin_font, 22, align="center")
        y -= 42

    line_height = font_size * 1.55
    max_chars = max(12, int((width - margin * 2) / (font_size * 0.62)))
    for paragraph in str(text).splitlines() or [""]:
        lines = textwrap.wrap(paragraph, width=max_chars, replace_whitespace=False) or [""]
        for line in lines:
            if y < margin:
                c.showPage()
                y = height - margin
            _pdf_draw_mixed_string(c, margin, y, line, cjk_font, latin_font, font_size)
            y -= line_height
        y -= line_height * 0.35

    c.save()
    return str(output)


def create_docx(text=None, output="output.docx", title=None, **kwargs):
    """Generate a Word .docx file.

    Correct:
        create_docx(content, output="report.docx", title="报告标题")
        create_docx({"报告": "", "一、背景": "正文"}, output="report.docx")

    Accepts:
        str: plain text or markdown-ish text (# headings, | tables |, - bullets)
        dict: keys become headings and nested dicts become lower-level headings
        list: paragraphs or table-like rows

    Compatibility:
        filename="report.docx" is accepted as output.
        content=... is accepted as text.
        create_docx("report.docx", content) and create_docx(title, content, filename="report.docx")
        are corrected automatically when possible.
    """
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import RGBColor, Cm
    from docx.shared import Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT

    formatting = dict(kwargs.get("formatting") or {}, **{k: v for k, v in kwargs.items() if k != "formatting"})
    alignment_values = {
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
        "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
    }
    paragraph_alignment = formatting.get("paragraph_alignment", formatting.get("alignment"))
    # The document title is distinct from section headings.  Keep headings at
    # their normal left alignment unless the caller explicitly supplies one.
    title_alignment = formatting.get("title_alignment", "center")
    heading_alignment = formatting.get("heading_alignment", paragraph_alignment)
    table_alignment = formatting.get("table_alignment")
    table_vertical_alignment = formatting.get("table_vertical_alignment")

    named_colors = {
        "black": "000000",
        "黑色": "000000",
        "white": "FFFFFF",
        "白色": "FFFFFF",
        "red": "FF0000",
        "红色": "FF0000",
        "blue": "0000FF",
        "蓝色": "0000FF",
        "green": "008000",
        "绿色": "008000",
        "gray": "808080",
        "grey": "808080",
        "灰色": "808080",
    }

    def normalize_color(value, default="000000"):
        raw = str(value or default).strip().lower()
        raw = named_colors.get(raw, raw).lstrip("#")
        if re.fullmatch(r"[0-9a-fA-F]{6}", raw):
            return raw.upper()
        return default

    def format_value(kind, name, default=None):
        if kind == "document_title":
            return formatting.get(f"title_{name}", formatting.get(name, default))
        if kind == "heading":
            return formatting.get(f"heading_{name}", formatting.get(name, default))
        return formatting.get(name, default)

    def clear_theme_color(color_element):
        if color_element is None:
            return
        for attr_name in ("w:themeColor", "w:themeTint", "w:themeShade"):
            color_element.attrib.pop(qn(attr_name), None)

    def clear_paragraph_border(paragraph_or_style):
        element = getattr(paragraph_or_style, "_p", None)
        if element is not None:
            p_pr = element.get_or_add_pPr()
        else:
            p_pr = paragraph_or_style._element.get_or_add_pPr()
        p_bdr = p_pr.find(qn("w:pBdr"))
        if p_bdr is not None:
            p_pr.remove(p_bdr)

    def apply_paragraph_layout(paragraph, kind="body"):
        fmt = paragraph.paragraph_format
        requested_alignment = paragraph_alignment
        if kind == "document_title":
            requested_alignment = title_alignment
        elif kind == "heading":
            requested_alignment = heading_alignment
        if isinstance(requested_alignment, str) and requested_alignment.lower() in alignment_values:
            value = alignment_values[requested_alignment.lower()]
            paragraph.alignment = value
            p_pr = paragraph._p.get_or_add_pPr()
            jc = p_pr.find(qn("w:jc"))
            if jc is None:
                jc = OxmlElement("w:jc")
                p_pr.append(jc)
            jc.set(qn("w:val"), requested_alignment.lower())
        if kind in {"document_title", "heading"}:
            clear_paragraph_border(paragraph)
        if formatting.get("line_spacing") is not None:
            fmt.line_spacing = float(formatting["line_spacing"])
        if formatting.get("space_before_pt") is not None:
            fmt.space_before = Pt(float(formatting["space_before_pt"]))
        if formatting.get("space_after_pt") is not None:
            fmt.space_after = Pt(float(formatting["space_after_pt"]))
        if formatting.get("first_line_indent_chars") is not None:
            fmt.first_line_indent = Cm(float(formatting["first_line_indent_chars"]) * 0.37)
        if formatting.get("left_indent_cm") is not None:
            fmt.left_indent = Cm(float(formatting["left_indent_cm"]))
        if formatting.get("right_indent_cm") is not None:
            fmt.right_indent = Cm(float(formatting["right_indent_cm"]))

    def apply_table_layout(table):
        if isinstance(table_alignment, str) and table_alignment.lower() in alignment_values:
            table.alignment = alignment_values[table_alignment.lower()]
        vertical_value = {
            "top": WD_CELL_VERTICAL_ALIGNMENT.TOP,
            "center": WD_CELL_VERTICAL_ALIGNMENT.CENTER,
            "bottom": WD_CELL_VERTICAL_ALIGNMENT.BOTTOM,
        }.get(str(table_vertical_alignment or "").lower())
        for row in table.rows:
            for cell in row.cells:
                if vertical_value is not None:
                    cell.vertical_alignment = vertical_value
                for paragraph in cell.paragraphs:
                    apply_paragraph_layout(paragraph, "table")

    content_value = kwargs.get("content") if "content" in kwargs else None
    if content_value is not None and _looks_like_docx_filename(text) and output == "output.docx":
        output = text
        text = content_value
    elif text is None and content_value is not None:
        text = content_value

    filename = kwargs.get("filename")
    if filename:
        if not _looks_like_docx_filename(output):
            if title is None and isinstance(text, str) and len(text.strip()) <= 120:
                title = text.strip()
            text = output
        output = filename

    if _looks_like_docx_filename(text) and not _looks_like_docx_filename(output):
        text, output = output, text

    if text is None:
        text = ""

    _ensure_parent(output)
    doc = Document()
    styles = doc.styles

    def apply_font_properties(target, kind="body", size=None, bold=None):
        explicit_font = format_value(kind, "font_name")
        latin_font = format_value(kind, "latin_font", explicit_font or "Times New Roman")
        cjk_font = format_value(kind, "cjk_font", explicit_font or "宋体")
        color = normalize_color(format_value(kind, "font_color", "000000"))
        underline = bool(format_value(kind, "underline", False))
        target.font.name = latin_font
        r_pr = target._element.get_or_add_rPr()
        r_fonts = r_pr.get_or_add_rFonts()
        r_fonts.set(qn("w:ascii"), latin_font)
        r_fonts.set(qn("w:hAnsi"), latin_font)
        r_fonts.set(qn("w:eastAsia"), cjk_font)
        for attr_name in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
            r_fonts.attrib.pop(qn(attr_name), None)
        target.font.color.rgb = RGBColor.from_string(color)
        clear_theme_color(r_pr.find(qn("w:color")))
        target.font.underline = underline
        if size is not None:
            target.font.size = Pt(size)
        if bold is not None:
            target.font.bold = bool(bold)

    style_specs = {
        "Normal": ("body", float(formatting.get("font_size", 12)), formatting.get("bold")),
        "Title": (
            "document_title",
            float(formatting.get("title_font_size", 18)),
            formatting.get("title_bold", True),
        ),
        "Heading 1": (
            "heading",
            float(formatting.get("heading_font_size", 16)),
            formatting.get("heading_bold", True),
        ),
        "Heading 2": (
            "heading",
            float(formatting.get("heading_font_size", 15)),
            formatting.get("heading_bold", True),
        ),
        "Heading 3": (
            "heading",
            float(formatting.get("heading_font_size", 14)),
            formatting.get("heading_bold", True),
        ),
    }
    for style_name, (kind, size, bold) in style_specs.items():
        style = styles[style_name]
        apply_font_properties(style, kind=kind, size=size, bold=bold)
        if kind in {"document_title", "heading"}:
            clear_paragraph_border(style)

    for style_name, kind in (
        ("Title Char", "document_title"),
        ("Heading 1 Char", "heading"),
        ("Heading 2 Char", "heading"),
        ("Heading 3 Char", "heading"),
    ):
        try:
            apply_font_properties(styles[style_name], kind=kind)
        except KeyError:
            pass

    def apply_run_font(run, kind="body", size=None, bold=None):
        apply_font_properties(run, kind=kind, size=size, bold=bold)

    def add_heading(text_value, level=1):
        heading = doc.add_heading(str(text_value).strip(), level=max(1, min(3, int(level))))
        apply_paragraph_layout(heading, "heading")
        default_sizes = {1: 16, 2: 15, 3: 14}
        for run in heading.runs:
            apply_run_font(
                run,
                kind="heading",
                size=float(formatting.get("heading_font_size", default_sizes.get(level, 14))),
                bold=formatting.get("heading_bold", True),
            )
        return heading

    def add_document_title(text_value):
        paragraph = doc.add_paragraph(style="Title")
        paragraph.add_run(str(text_value).strip())
        apply_paragraph_layout(paragraph, "document_title")
        for run in paragraph.runs:
            apply_run_font(
                run,
                kind="document_title",
                size=float(formatting.get("title_font_size", 18)),
                bold=formatting.get("title_bold", True),
            )
        return paragraph

    def add_paragraph(text_value):
        value = _strip_markdown_inline(text_value)
        if not value:
            return None
        p = doc.add_paragraph(value)
        apply_paragraph_layout(p)
        for run in p.runs:
            apply_run_font(
                run,
                size=float(formatting.get("font_size", 12)),
                bold=formatting.get("bold"),
            )
        return p

    def add_bullet(text_value):
        value = _strip_markdown_inline(text_value)
        if not value:
            return None
        p = doc.add_paragraph(style="List Bullet")
        apply_paragraph_layout(p)
        run = p.add_run(value)
        apply_run_font(
            run,
            size=float(formatting.get("font_size", 12)),
            bold=formatting.get("bold"),
        )
        return p

    def add_table(rows):
        if not rows:
            return None
        if isinstance(rows[0], dict):
            headers = list(rows[0].keys())
            body_rows = [[row.get(header, "") for header in headers] for row in rows]
        else:
            headers = [str(cell) for cell in rows[0]]
            body_rows = rows[1:]
        table = doc.add_table(rows=1, cols=len(headers), style="Table Grid")
        for idx, header in enumerate(headers):
            cell = table.rows[0].cells[idx]
            cell.text = _strip_markdown_inline(header)
            for run in cell.paragraphs[0].runs:
                apply_run_font(run, size=float(formatting.get("table_font_size", 11)), bold=True)
        for row in body_rows:
            cells = table.add_row().cells
            for idx in range(len(headers)):
                cells[idx].text = _strip_markdown_inline(row[idx] if idx < len(row) else "")
                for run in cells[idx].paragraphs[0].runs:
                    apply_run_font(run, size=float(formatting.get("table_font_size", 11)))
        apply_table_layout(table)
        return table

    def render_text_block(value):
        lines = str(value).splitlines()
        idx = 0
        checked_first_content_line = False
        while idx < len(lines):
            raw_line = lines[idx]
            line = raw_line.strip()
            if not line:
                idx += 1
                continue
            if (
                title
                and not checked_first_content_line
                and _strip_markdown_inline(line) == _strip_markdown_inline(title)
            ):
                checked_first_content_line = True
                idx += 1
                continue
            checked_first_content_line = True
            if _is_markdown_table_row(line):
                table_lines = []
                while idx < len(lines) and _is_markdown_table_row(lines[idx].strip()):
                    table_lines.append(lines[idx].strip())
                    idx += 1
                parsed_table = _parse_markdown_table(table_lines)
                if parsed_table:
                    add_table(parsed_table)
                continue
            if _looks_like_markdown_heading(line):
                heading_level, heading_text = _markdown_heading_level(line)
                add_heading(_strip_markdown_inline(heading_text), heading_level)
            elif _looks_like_chinese_section_heading(line):
                heading_level = 2 if re.match(r"^(（|\()", line) else 1
                add_heading(_strip_markdown_inline(line), heading_level)
            elif re.match(r"^[-*+]\s+\S", line):
                add_bullet(re.sub(r"^[-*+]\s+", "", line))
            else:
                add_paragraph(line)
            idx += 1

    def render_value(value, level=1, top_level=False):
        if _is_empty_docx_value(value):
            return
        if isinstance(value, dict):
            for key_index, (key, child) in enumerate(value.items()):
                key_text = str(key).strip()
                # A caller may pass both title="X" and {"X": ...}.  The
                # explicit document title already represents that top-level
                # key, so render its contents without emitting a second title.
                duplicate_top_title = (
                    top_level
                    and key_index == 0
                    and title
                    and _strip_markdown_inline(key_text)
                    == _strip_markdown_inline(str(title))
                )
                if key_text and not duplicate_top_title:
                    add_heading(key_text, level)
                render_value(child, level + 1, top_level=False)
            return
        if isinstance(value, (list, tuple)):
            if value and all(isinstance(item, dict) for item in value):
                key_sets = [set(item.keys()) for item in value]
                if key_sets and all(keys == key_sets[0] for keys in key_sets):
                    add_table(list(value))
                    return
            for item in value:
                render_value(item, level, top_level=False)
            return
        render_text_block(value)

    working_text = text
    if isinstance(working_text, dict):
        items = list(working_text.items())
        if title is None and items:
            first_key, first_value = items[0]
            if _is_empty_docx_value(first_value):
                title = str(first_key).strip()
                working_text = dict(items[1:])
            elif len(items) == 1 and isinstance(first_value, (dict, list, tuple, str)):
                title = str(first_key).strip()
                working_text = first_value

    if title:
        add_document_title(str(title))

    render_value(working_text, level=1, top_level=True)
    doc.save(output)
    return str(output)


def create_xlsx(data, output="output.xlsx", sheet_name="Sheet1"):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    _ensure_parent(output)
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name[:31]
    rows = data
    if isinstance(data, dict):
        rows = data.get("rows", data)
    if rows and isinstance(rows[0], dict):
        headers = list(rows[0].keys())
        ws.append(headers)
        for row in rows:
            ws.append([row.get(h, "") for h in headers])
    else:
        for row in rows:
            ws.append(row if isinstance(row, (list, tuple)) else [row])

    for row in ws.iter_rows():
        for cell in row:
            cell.font = Font(name=_office_font_name(cell.value))
            cell.alignment = Alignment(vertical="center", wrap_text=True)
    for cell in ws[1]:
        cell.font = Font(name=_office_font_name(cell.value), bold=True)
        cell.fill = PatternFill("solid", fgColor="EAF2F8")
    for col in ws.columns:
        width = min(42, max(10, max(len(str(c.value or "")) for c in col) + 2))
        ws.column_dimensions[get_column_letter(col[0].column)].width = width
    wb.save(output)
    return str(output)


def _setup_plotting():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager

    font_candidates = [
        SONGTI_FONT,
        *CJK_FONT_FALLBACKS,
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    family = "DejaVu Sans"
    for font_path in font_candidates:
        if font_path and Path(font_path).exists():
            try:
                font_manager.fontManager.addfont(font_path)
                family = font_manager.FontProperties(fname=font_path).get_name()
                break
            except Exception:
                continue
    plt.rcParams["font.family"] = [family, "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    return plt


def _to_dataframe(data):
    import pandas as pd

    if hasattr(data, "copy") and hasattr(data, "columns"):
        return data.copy()
    if isinstance(data, dict):
        if "rows" in data:
            return pd.DataFrame(data["rows"])
        if "data" in data:
            return pd.DataFrame(data["data"])
        return pd.DataFrame(data)
    return pd.DataFrame(data)


def _numeric_columns(df):
    return list(df.select_dtypes(include="number").columns)


def _resolve_xy(df, x=None, y=None):
    columns = list(df.columns)
    if not columns:
        raise ValueError("No columns found for chart data.")
    numeric = _numeric_columns(df)
    x = x or (columns[0] if columns else None)
    y = y or (numeric[0] if numeric else (columns[1] if len(columns) > 1 else columns[0]))
    if x not in df.columns:
        raise ValueError(f"x column not found: {x}")
    if y not in df.columns:
        raise ValueError(f"y column not found: {y}")
    return x, y


def _save_figure(fig, output, dpi=180):
    _ensure_parent(output)
    fig.savefig(output, dpi=dpi, bbox_inches="tight", facecolor="white")
    return str(output)


def create_line_chart(
    data,
    output="line_chart.png",
    x=None,
    y=None,
    title=None,
    xlabel=None,
    ylabel=None,
    figsize=(9, 5),
):
    """Create a PNG line chart from rows/dicts/DataFrame data."""
    plt = _setup_plotting()
    df = _to_dataframe(data)
    x, y = _resolve_xy(df, x, y)
    fig, ax = plt.subplots(figsize=figsize)
    ax.plot(df[x], df[y], marker="o", linewidth=2.2, color="#2563eb")
    ax.set_title(title or f"{y} trend")
    ax.set_xlabel(xlabel or x)
    ax.set_ylabel(ylabel or y)
    ax.grid(True, linestyle="--", alpha=0.35)
    fig.autofmt_xdate(rotation=25)
    out = _save_figure(fig, output)
    plt.close(fig)
    return out


def create_bar_chart(
    data,
    output="bar_chart.png",
    x=None,
    y=None,
    title=None,
    xlabel=None,
    ylabel=None,
    figsize=(9, 5),
):
    """Create a PNG bar chart from rows/dicts/DataFrame data."""
    plt = _setup_plotting()
    df = _to_dataframe(data)
    x, y = _resolve_xy(df, x, y)
    fig, ax = plt.subplots(figsize=figsize)
    ax.bar(df[x].astype(str), df[y], color="#16a34a")
    ax.set_title(title or f"{y} by {x}")
    ax.set_xlabel(xlabel or x)
    ax.set_ylabel(ylabel or y)
    ax.grid(True, axis="y", linestyle="--", alpha=0.3)
    fig.autofmt_xdate(rotation=25)
    out = _save_figure(fig, output)
    plt.close(fig)
    return out


def create_pie_chart(
    data,
    output="pie_chart.png",
    labels=None,
    values=None,
    title=None,
    figsize=(7, 7),
):
    """Create a PNG pie chart from rows/dicts/DataFrame data."""
    plt = _setup_plotting()
    df = _to_dataframe(data)
    columns = list(df.columns)
    numeric = _numeric_columns(df)
    labels = labels or (columns[0] if columns else None)
    values = values or (numeric[0] if numeric else (columns[1] if len(columns) > 1 else None))
    if labels not in df.columns or values not in df.columns:
        raise ValueError("Pie chart requires label and value columns.")
    fig, ax = plt.subplots(figsize=figsize)
    ax.pie(
        df[values],
        labels=df[labels].astype(str),
        autopct="%1.1f%%",
        startangle=90,
        counterclock=False,
    )
    ax.set_title(title or f"{values} share")
    ax.axis("equal")
    out = _save_figure(fig, output)
    plt.close(fig)
    return out


def create_heatmap(
    matrix,
    output="heatmap.png",
    xlabels=None,
    ylabels=None,
    title="Heatmap",
    cmap="YlGnBu",
    annotate=True,
    figsize=(8, 6),
):
    """Create a PNG heatmap from a numeric matrix or DataFrame."""
    import numpy as np

    plt = _setup_plotting()
    if hasattr(matrix, "values") and hasattr(matrix, "columns"):
        values = matrix.values
        xlabels = xlabels or list(matrix.columns)
        ylabels = ylabels or list(matrix.index)
    else:
        values = np.array(matrix, dtype=float)
    fig, ax = plt.subplots(figsize=figsize)
    im = ax.imshow(values, cmap=cmap, aspect="auto")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    if xlabels is not None:
        ax.set_xticks(range(len(xlabels)))
        ax.set_xticklabels([str(v) for v in xlabels], rotation=35, ha="right")
    if ylabels is not None:
        ax.set_yticks(range(len(ylabels)))
        ax.set_yticklabels([str(v) for v in ylabels])
    if annotate:
        for i in range(values.shape[0]):
            for j in range(values.shape[1]):
                ax.text(j, i, f"{values[i, j]:.2g}", ha="center", va="center", fontsize=9)
    ax.set_title(title)
    out = _save_figure(fig, output)
    plt.close(fig)
    return out


def create_chart(chart_type, data, output=None, **kwargs):
    """Dispatch helper for line/bar/pie/heatmap charts."""
    chart_type = str(chart_type).lower().strip()
    output = output or f"{chart_type}_chart.png"
    if chart_type in {"line", "折线图"}:
        return create_line_chart(data, output=output, **kwargs)
    if chart_type in {"bar", "柱状图"}:
        return create_bar_chart(data, output=output, **kwargs)
    if chart_type in {"pie", "饼图"}:
        return create_pie_chart(data, output=output, **kwargs)
    if chart_type in {"heatmap", "热力图"}:
        return create_heatmap(data, output=output, **kwargs)
    raise ValueError(f"Unsupported chart type: {chart_type}")


def create_dashboard(
    data,
    output="dashboard.png",
    title="Dashboard",
    x=None,
    y=None,
    category=None,
    value=None,
    heatmap_data=None,
    metrics=None,
):
    """Create a simple dashboard screenshot PNG with metrics and common charts."""
    import numpy as np

    plt = _setup_plotting()
    df = _to_dataframe(data)
    x, y = _resolve_xy(df, x, y)
    category = category or x
    value = value or y
    metrics = metrics or []

    fig = plt.figure(figsize=(13, 8))
    gs = fig.add_gridspec(3, 4, height_ratios=[0.8, 2, 2])
    fig.suptitle(title, fontsize=20, fontweight="bold", y=0.98)

    numeric = _numeric_columns(df)
    auto_metrics = [
        ("记录数", len(df)),
        (f"{value}合计", round(float(df[value].sum()), 2) if value in numeric else "N/A"),
        (f"{value}均值", round(float(df[value].mean()), 2) if value in numeric else "N/A"),
    ]
    for idx, (label, number) in enumerate((metrics or auto_metrics)[:4]):
        ax = fig.add_subplot(gs[0, idx])
        ax.axis("off")
        ax.text(0.03, 0.68, str(label), fontsize=11, color="#475569")
        ax.text(0.03, 0.18, str(number), fontsize=22, fontweight="bold", color="#0f172a")
        ax.add_patch(plt.Rectangle((0, 0), 1, 1, fill=False, edgecolor="#cbd5e1", linewidth=1))

    ax1 = fig.add_subplot(gs[1, :2])
    ax1.plot(df[x], df[y], marker="o", linewidth=2, color="#2563eb")
    ax1.set_title("趋势")
    ax1.grid(True, linestyle="--", alpha=0.3)
    ax1.tick_params(axis="x", rotation=25)

    ax2 = fig.add_subplot(gs[1, 2:])
    ax2.bar(df[category].astype(str), df[value], color="#16a34a")
    ax2.set_title("对比")
    ax2.grid(True, axis="y", linestyle="--", alpha=0.3)
    ax2.tick_params(axis="x", rotation=25)

    ax3 = fig.add_subplot(gs[2, :2])
    pie_df = df[[category, value]].groupby(category, as_index=False).sum().head(8)
    ax3.pie(pie_df[value], labels=pie_df[category].astype(str), autopct="%1.1f%%", startangle=90)
    ax3.set_title("占比")

    ax4 = fig.add_subplot(gs[2, 2:])
    if heatmap_data is None:
        heatmap_values = df[numeric].corr().values if len(numeric) >= 2 else np.array([[1, 0], [0, 1]])
        xlabels = numeric if len(numeric) >= 2 else ["A", "B"]
        ylabels = xlabels
    else:
        heatmap_values = np.array(heatmap_data, dtype=float)
        xlabels = None
        ylabels = None
    im = ax4.imshow(heatmap_values, cmap="YlGnBu", aspect="auto")
    ax4.set_title("热力图")
    ax4.set_xticks(range(len(xlabels)) if xlabels else [])
    ax4.set_yticks(range(len(ylabels)) if ylabels else [])
    if xlabels:
        ax4.set_xticklabels([str(v) for v in xlabels], rotation=35, ha="right")
        ax4.set_yticklabels([str(v) for v in ylabels])
    fig.colorbar(im, ax=ax4, fraction=0.046, pad=0.04)

    fig.tight_layout(rect=[0, 0, 1, 0.95])
    out = _save_figure(fig, output)
    plt.close(fig)
    return out


def create_visual_report(
    data,
    output_prefix="visual_report",
    title="Visual Report",
    x=None,
    y=None,
    category=None,
    value=None,
):
    """Create PNG charts plus PDF and Excel reports. Returns a dict of output paths."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
    from openpyxl import load_workbook
    from openpyxl.drawing.image import Image as XLImage

    df = _to_dataframe(data)
    x, y = _resolve_xy(df, x, y)
    category = category or x
    value = value or y
    prefix = str(output_prefix).rstrip("_")

    outputs = {
        "line_png": create_line_chart(df, f"{prefix}_line.png", x=x, y=y, title=f"{title} - 趋势"),
        "bar_png": create_bar_chart(df, f"{prefix}_bar.png", x=category, y=value, title=f"{title} - 对比"),
        "pie_png": create_pie_chart(df[[category, value]].groupby(category, as_index=False).sum(), f"{prefix}_pie.png", labels=category, values=value, title=f"{title} - 占比"),
        "dashboard_png": create_dashboard(df, f"{prefix}_dashboard.png", title=title, x=x, y=y, category=category, value=value),
    }

    xlsx_path = f"{prefix}.xlsx"
    create_xlsx(df.to_dict("records"), xlsx_path, sheet_name="Data")
    wb = load_workbook(xlsx_path)
    ws = wb.create_sheet("Charts")
    row = 1
    for label, image_path in outputs.items():
        ws.cell(row=row, column=1, value=label)
        img = XLImage(image_path)
        img.width = min(img.width, 720)
        img.height = min(img.height, 420)
        ws.add_image(img, f"A{row + 1}")
        row += 24
    wb.save(xlsx_path)
    outputs["excel_report"] = xlsx_path

    pdf_path = f"{prefix}.pdf"
    _ensure_parent(pdf_path)
    c = canvas.Canvas(pdf_path, pagesize=A4)
    page_w, page_h = A4
    cjk_font, latin_font = _register_reportlab_fonts()
    c.setFont(cjk_font, 20)
    c.drawCentredString(page_w / 2, page_h - 50, title)
    y_pos = page_h - 90
    for image_path in [outputs["dashboard_png"], outputs["line_png"], outputs["bar_png"], outputs["pie_png"]]:
        reader = ImageReader(image_path)
        img_w, img_h = reader.getSize()
        max_w = page_w - 80
        max_h = 250
        scale = min(max_w / img_w, max_h / img_h)
        draw_w = img_w * scale
        draw_h = img_h * scale
        if y_pos - draw_h < 50:
            c.showPage()
            c.setFont(cjk_font, 16)
            y_pos = page_h - 50
        c.drawImage(reader, (page_w - draw_w) / 2, y_pos - draw_h, draw_w, draw_h)
        y_pos -= draw_h + 24
    c.save()
    outputs["pdf_report"] = pdf_path
    return outputs


def create_pptx(title, bullets=None, output="output.pptx"):
    from pptx import Presentation
    from pptx.util import Pt

    _ensure_parent(output)
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = str(title)
    body = slide.placeholders[1].text_frame
    body.clear()
    for i, bullet in enumerate(bullets or []):
        p = body.paragraphs[0] if i == 0 else body.add_paragraph()
        p.text = str(bullet)
        p.font.name = _office_font_name(p.text)
        p.font.size = Pt(20)
    for shape in slide.shapes:
        if hasattr(shape, "text_frame"):
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    run.font.name = _office_font_name(run.text)
    prs.save(output)
    return str(output)


def read_docx(path, max_chars=120000):
    try:
        pack = docx_extract_blocks(path, output_dir=None, max_chars=max_chars, extract_images=False)
        parts = []
        for block in pack["blocks"]:
            if block["type"] == "text" and block.get("text"):
                parts.append(block["text"])
            elif block["type"] == "image":
                parts.append(
                    "[Embedded image "
                    + str(block.get("image_index"))
                    + " near paragraph "
                    + str(block.get("paragraph_index"))
                    + ": "
                    + str(block.get("original_name") or block.get("relationship_id") or "image")
                    + "]"
                )
        if parts:
            return "\n".join(parts)[:max_chars]
    except Exception:
        pass

    try:
        from docx import Document

        doc = Document(path)
        parts = [p.text for p in doc.paragraphs if p.text]
        for table in doc.tables:
            for row in table.rows:
                parts.append("\t".join(cell.text for cell in row.cells))
        return "\n".join(parts)[:max_chars]
    except ModuleNotFoundError:
        from zipfile import ZipFile
        import xml.etree.ElementTree as ET

        ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        with ZipFile(path) as archive:
            document_xml = archive.read("word/document.xml")
        root = ET.fromstring(document_xml)
        parts = []
        for paragraph in root.iter(ns + "p"):
            text = "".join(node.text or "" for node in paragraph.iter(ns + "t")).strip()
            if text:
                parts.append(text)
        return "\n".join(parts)[:max_chars]


def _clean_xlsx_value(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    return value


def _xlsx_sheet_media_counts(ws):
    images = len(getattr(ws, "_images", []) or [])
    charts = len(getattr(ws, "_charts", []) or [])
    tables = len(getattr(ws, "tables", {}) or {})
    return {"images": images, "charts": charts, "tables": tables}


def read_xlsx(path, max_rows=200, include_metadata=True):
    """Read an .xlsx workbook with sheet data and metadata.

    Returns a dict of sheet_name -> rows plus "_metadata" when include_metadata=True.
    Metadata includes max row/column, merged ranges, formulas, hidden rows/columns,
    and image/chart/table counts. Use this for spreadsheet Q&A instead of relying on
    short attachment summaries.
    """
    from openpyxl import load_workbook

    wb = load_workbook(path, data_only=True, read_only=False)
    formula_wb = load_workbook(path, data_only=False, read_only=False)
    result = {}
    metadata = {"path": str(path), "sheets": {}}

    for ws in wb.worksheets:
        formula_ws = formula_wb[ws.title]
        rows = []
        non_empty_cells = 0
        formula_cells = 0
        formula_cells_without_cached_value = 0
        hidden_rows = []
        hidden_columns = []

        for row_idx in range(1, ws.max_row + 1):
            if ws.row_dimensions[row_idx].hidden:
                hidden_rows.append(row_idx)
        for col_letter, dim in ws.column_dimensions.items():
            if dim.hidden:
                hidden_columns.append(col_letter)

        for i, row in enumerate(ws.iter_rows(values_only=False)):
            if i >= max_rows:
                break
            values = []
            for cell in row:
                value = _clean_xlsx_value(cell.value)
                formula_value = formula_ws[cell.coordinate].value
                if value not in (None, ""):
                    non_empty_cells += 1
                if isinstance(formula_value, str) and formula_value.startswith("="):
                    formula_cells += 1
                    if value in (None, ""):
                        formula_cells_without_cached_value += 1
                values.append(value)
            rows.append(values)

        result[ws.title] = rows

        media_counts = _xlsx_sheet_media_counts(ws)
        metadata["sheets"][ws.title] = {
            "max_row": ws.max_row,
            "max_column": ws.max_column,
            "read_rows": len(rows),
            "truncated": ws.max_row > max_rows,
            "non_empty_cells_in_read_rows": non_empty_cells,
            "merged_ranges": [str(rng) for rng in ws.merged_cells.ranges],
            "hidden_rows": hidden_rows,
            "hidden_columns": hidden_columns,
            "formula_cells": formula_cells,
            "formula_cells_without_cached_value": formula_cells_without_cached_value,
            **media_counts,
        }

    if include_metadata:
        result["_metadata"] = metadata
    return result


def _convert_legacy_office_for_reading(input_path, target_suffix, timeout=180):
    """Convert a legacy Office file to a modern format for text/table reading."""
    input_path = _as_path(input_path).resolve()
    if not _has_binary("libreoffice", "soffice"):
        raise RuntimeError(
            f"Cannot read {input_path.suffix.lower()} directly. "
            "Missing libreoffice/soffice to convert it for reading."
        )

    import tempfile

    soffice = _require_binary("libreoffice", "soffice")
    with tempfile.TemporaryDirectory(prefix="sansuo_legacy_office_") as tmp:
        tmp_dir = Path(tmp)
        before = {p.resolve() for p in tmp_dir.glob("*")}
        result = _run_completed(
            [
                soffice,
                "--headless",
                "--nologo",
                "--nofirststartwizard",
                "--convert-to",
                target_suffix.lstrip("."),
                "--outdir",
                str(tmp_dir),
                str(input_path),
            ],
            timeout=timeout,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "LibreOffice conversion for reading failed: "
                + " ".join([
                    soffice,
                    "--headless",
                    "--convert-to",
                    target_suffix.lstrip("."),
                    "--outdir",
                    str(tmp_dir),
                    str(input_path),
                ])
                + "\nSTDOUT:\n"
                + (result.stdout or "")
                + "\nSTDERR:\n"
                + (result.stderr or "")
            )

        candidates = [
            p for p in tmp_dir.glob(f"*{target_suffix}") if p.resolve() not in before and p.stat().st_size > 0
        ]
        exact = tmp_dir / f"{input_path.stem}{target_suffix}"
        if exact.exists() and exact.stat().st_size > 0:
            candidates.insert(0, exact)
        if not candidates:
            listing = "\n".join(
                f"{p.name}\t{p.stat().st_size} bytes" for p in sorted(tmp_dir.glob("*"))
            )
            raise RuntimeError(
                f"LibreOffice did not create a non-empty {target_suffix} file for {input_path}"
                + "\nSTDOUT:\n"
                + (result.stdout or "")
                + "\nSTDERR:\n"
                + (result.stderr or "")
                + "\nOUTPUT_DIR:\n"
                + (listing or "(empty)")
            )

        converted = candidates[0]
        stable_path = Path.cwd() / f"{input_path.stem}_converted_for_reading{target_suffix}"
        shutil.copyfile(converted, stable_path)
        return stable_path


def read_doc(path, max_chars=120000):
    """Read legacy .doc by converting to DOCX with LibreOffice first."""
    converted = _convert_legacy_office_for_reading(path, ".docx")
    return read_docx(converted, max_chars=max_chars)


def read_xls(path, max_rows=200, include_metadata=True):
    """Read legacy .xls by converting to XLSX with LibreOffice first."""
    converted = _convert_legacy_office_for_reading(path, ".xlsx")
    return read_xlsx(converted, max_rows=max_rows, include_metadata=include_metadata)


def read_pptx(path, max_chars=120000):
    from pptx import Presentation

    prs = Presentation(path)
    parts = []
    for idx, slide in enumerate(prs.slides, 1):
        texts = []
        for shape in slide.shapes:
            if hasattr(shape, "text") and shape.text:
                texts.append(shape.text)
        if texts:
            parts.append(f"--- Slide {idx} ---\n" + "\n".join(texts))
    return "\n\n".join(parts)[:max_chars]


def read_pdf(path, max_chars=120000):
    """Extract text from a normal text-based PDF.

    Use for ordinary PDFs with selectable text. For uploaded PDFs where type is
    uncertain, or for long/mixed/scanned/image-heavy PDFs, prefer read_pdf_smart().
    """
    from pypdf import PdfReader

    reader = PdfReader(path)
    parts = []
    for i, page in enumerate(reader.pages, 1):
        parts.append(f"--- Page {i} ---\n{page.extract_text() or ''}")
    return "\n\n".join(parts)[:max_chars]


def _json_default(value):
    try:
        import datetime

        if isinstance(value, (datetime.date, datetime.datetime)):
            return value.isoformat()
    except Exception:
        pass
    return str(value)


def _write_json(path, data):
    _ensure_parent(path)
    Path(path).write_text(
        json.dumps(data, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )
    return str(path)


def _normalize_text(text):
    text = re.sub(r"[ \t]+", " ", str(text or ""))
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _table_to_markdown(table, max_rows=80, max_cols=20):
    rows = table[:max_rows]
    if not rows:
        return ""
    rows = [[("" if cell is None else str(cell)).replace("\n", " ").strip() for cell in row[:max_cols]] for row in rows]
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    header = rows[0]
    body = rows[1:] if len(rows) > 1 else []
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _chunk_text(text, max_chars=4500, overlap=350):
    text = _normalize_text(text)
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    paragraphs = re.split(r"\n\s*\n", text)
    chunks = []
    current = ""
    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if len(paragraph) > max_chars:
            if current:
                chunks.append(current.strip())
                current = ""
            start = 0
            while start < len(paragraph):
                end = min(len(paragraph), start + max_chars)
                chunks.append(paragraph[start:end].strip())
                if end == len(paragraph):
                    break
                start = max(0, end - overlap)
            continue
        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if len(candidate) > max_chars and current:
            chunks.append(current.strip())
            tail = current[-overlap:].strip() if overlap and len(current) > overlap else ""
            current = f"{tail}\n\n{paragraph}".strip() if tail else paragraph
        else:
            current = candidate
    if current:
        chunks.append(current.strip())
    return chunks


_DOCX_NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "v": "urn:schemas-microsoft-com:vml",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def _safe_output_name(name):
    name = Path(str(name or "file")).name
    name = re.sub(r"[\0-\x1f\x7f/\\:]+", "_", name).strip()
    return name or "file"


def _docx_relationships(archive):
    import xml.etree.ElementTree as ET

    rels = {}
    try:
        root = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
    except KeyError:
        return rels
    for rel in root.findall("rel:Relationship", _DOCX_NS):
        rid = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        rel_type = rel.attrib.get("Type", "")
        if rid and target:
            rels[rid] = {"target": target, "type": rel_type}
    return rels


def _docx_target_to_zip_path(target):
    target = str(target or "").replace("\\", "/")
    if target.startswith("/"):
        target = target.lstrip("/")
    elif not target.startswith("word/"):
        target = "word/" + target
    parts = []
    for part in target.split("/"):
        if part in {"", "."}:
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def _docx_paragraph_text(paragraph):
    texts = []
    for node in paragraph.iter():
        tag = node.tag.rsplit("}", 1)[-1]
        if tag == "t":
            texts.append(node.text or "")
        elif tag == "tab":
            texts.append("\t")
        elif tag in {"br", "cr"}:
            texts.append("\n")
    return _normalize_text("".join(texts))


def _docx_paragraph_image_refs(paragraph):
    refs = []
    for blip in paragraph.findall(".//a:blip", _DOCX_NS):
        rid = blip.attrib.get("{" + _DOCX_NS["r"] + "}embed") or blip.attrib.get(
            "{" + _DOCX_NS["r"] + "}link"
        )
        if rid:
            refs.append(rid)
    for image_data in paragraph.findall(".//v:imagedata", _DOCX_NS):
        rid = image_data.attrib.get("{" + _DOCX_NS["r"] + "}id")
        if rid:
            refs.append(rid)
    return refs


def _nearest_text(blocks, image_position, direction):
    step = -1 if direction == "before" else 1
    index = image_position + step
    while 0 <= index < len(blocks):
        block = blocks[index]
        if block.get("type") == "text" and block.get("text"):
            return block["text"][:300]
        index += step
    return ""


def docx_extract_blocks(input_docx, output_dir=None, max_chars=120000, extract_images=True):
    """Extract DOCX text and embedded images with paragraph-level positions.

    The result is designed for document understanding: text remains in reading
    order, and each image records the paragraph index plus nearby text. It does
    not call a vision model by itself; feed the extracted image files to the VL
    model only when the user asks about visual content.
    """
    import xml.etree.ElementTree as ET

    input_docx = _as_path(input_docx)
    output_dir_path = _as_path(output_dir) if output_dir else None
    images_dir = output_dir_path / "images" if output_dir_path else None
    if images_dir and extract_images:
        images_dir.mkdir(parents=True, exist_ok=True)

    blocks = []
    image_count = 0
    text_chars = 0
    with zipfile.ZipFile(input_docx) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
        rels = _docx_relationships(archive)
        paragraphs = root.findall(".//w:p", _DOCX_NS)
        for paragraph_index, paragraph in enumerate(paragraphs, 1):
            text = _docx_paragraph_text(paragraph)
            if text:
                if text_chars < max_chars:
                    remaining = max_chars - text_chars
                    clipped = text[:remaining]
                    blocks.append({
                        "type": "text",
                        "paragraph_index": paragraph_index,
                        "text": clipped,
                        "text_chars": len(clipped),
                    })
                    text_chars += len(clipped)
                elif text_chars == max_chars:
                    blocks.append({
                        "type": "notice",
                        "paragraph_index": paragraph_index,
                        "text": "Text clipped at max_chars.",
                    })
                    text_chars += 1

            for rid in _docx_paragraph_image_refs(paragraph):
                image_count += 1
                rel = rels.get(rid, {})
                target = rel.get("target", "")
                zip_path = _docx_target_to_zip_path(target)
                original_name = Path(zip_path).name or f"image_{image_count}"
                output_image = None
                size = None
                if extract_images and images_dir:
                    try:
                        data = archive.read(zip_path)
                        ext = Path(original_name).suffix or ".bin"
                        output_name = f"image_{image_count:03d}{ext.lower()}"
                        output_path = images_dir / _safe_output_name(output_name)
                        output_path.write_bytes(data)
                        output_image = _display_path(output_path)
                        size = len(data)
                    except KeyError:
                        output_image = None
                blocks.append({
                    "type": "image",
                    "image_index": image_count,
                    "paragraph_index": paragraph_index,
                    "relationship_id": rid,
                    "target": target,
                    "zip_path": zip_path,
                    "original_name": original_name,
                    "extracted_path": output_image,
                    "size": size,
                })

    for index, block in enumerate(blocks):
        if block.get("type") == "image":
            block["before_text"] = _nearest_text(blocks, index, "before")
            block["after_text"] = _nearest_text(blocks, index, "after")

    return {
        "source": str(input_docx),
        "text_chars": min(text_chars, max_chars),
        "image_count": image_count,
        "blocks": blocks,
    }


def docx_build_reading_pack(input_docx, output_prefix=None, max_chars=120000, extract_images=True):
    """Create a DOCX reading pack with text, image files, and image positions.

    Use for Word documents containing screenshots, diagrams, charts, or embedded images.
    Outputs markdown/jsonl/manifest files and extracted images with paragraph-level
    before/after context.
    """
    input_docx = _as_path(input_docx)
    prefix = output_prefix or input_docx.stem
    output_dir = Path(f"{prefix}_docx_assets")
    output_dir.mkdir(parents=True, exist_ok=True)

    pack = docx_extract_blocks(
        input_docx,
        output_dir=output_dir,
        max_chars=max_chars,
        extract_images=extract_images,
    )
    blocks_path = f"{prefix}_docx_blocks.jsonl"
    manifest_path = f"{prefix}_docx_manifest.json"
    markdown_path = f"{prefix}_docx_reading_pack.md"

    with open(blocks_path, "w", encoding="utf-8") as f:
        for block in pack["blocks"]:
            f.write(json.dumps(block, ensure_ascii=False, default=_json_default) + "\n")

    image_blocks = [block for block in pack["blocks"] if block.get("type") == "image"]
    manifest = {
        "source": input_docx.name,
        "text_chars": pack["text_chars"],
        "image_count": pack["image_count"],
        "blocks": blocks_path,
        "assets_dir": _display_path(output_dir),
        "images": image_blocks,
        "usage": [
            "Use text blocks for normal summary and Q&A.",
            "Use extracted image files with the VL model when the user asks about screenshots, diagrams, figures, or visual content.",
            "Image positions are paragraph-level anchors with before_text and after_text context.",
        ],
    }
    _write_json(manifest_path, manifest)

    lines = [
        f"# DOCX Reading Pack: {input_docx.name}",
        "",
        f"- Text chars: {pack['text_chars']}",
        f"- Embedded images: {pack['image_count']}",
        f"- Blocks: `{blocks_path}`",
        f"- Manifest: `{manifest_path}`",
        f"- Assets directory: `{_display_path(output_dir)}`",
        "",
        "## Reading Order Preview",
    ]
    text_seen = 0
    for block in pack["blocks"]:
        if block.get("type") == "text" and block.get("text"):
            text_seen += 1
            if text_seen <= 40:
                lines.extend([
                    "",
                    f"### Paragraph {block['paragraph_index']}",
                    block["text"],
                ])
        elif block.get("type") == "image":
            lines.extend([
                "",
                f"### Image {block['image_index']} near paragraph {block['paragraph_index']}",
                f"- Original: `{block.get('original_name')}`",
                f"- Extracted: `{block.get('extracted_path') or 'not extracted'}`",
                f"- Before: {block.get('before_text') or '(none)'}",
                f"- After: {block.get('after_text') or '(none)'}",
            ])
            if block.get("extracted_path"):
                lines.append(f"![Image {block['image_index']}]({block['extracted_path']})")
    write_text(markdown_path, "\n".join(lines))

    return {
        "manifest": manifest_path,
        "blocks": blocks_path,
        "index": markdown_path,
        "assets_dir": _display_path(output_dir),
        "image_count": pack["image_count"],
        "text_chars": pack["text_chars"],
    }


def pdf_profile(input_pdf, output="pdf_profile.json", max_pages=None):
    """Inspect a PDF and decide whether text extraction, vision, or a hybrid route is needed."""
    import fitz

    input_pdf = _as_path(input_pdf)
    doc = fitz.open(str(input_pdf))
    total_pages = doc.page_count
    pages = []
    text_pages = 0
    low_text_pages = 0
    image_pages = 0
    scanned_like_pages = []
    sparse_text_pages = []

    page_limit = total_pages if max_pages is None else min(total_pages, int(max_pages))
    for index in range(page_limit):
      page = doc.load_page(index)
      text = _normalize_text(page.get_text("text"))
      image_count = len(page.get_images(full=True))
      drawing_count = len(page.get_drawings())
      char_count = len(text)
      has_text = char_count >= 80
      low_text = char_count < 40
      sparse_text = char_count < 160
      if has_text:
          text_pages += 1
      if low_text:
          low_text_pages += 1
      if sparse_text:
          sparse_text_pages.append(index + 1)
      if image_count:
          image_pages += 1
      scanned_like = low_text and image_count > 0
      if scanned_like:
          scanned_like_pages.append(index + 1)
      pages.append({
          "page": index + 1,
          "text_chars": char_count,
          "image_count": image_count,
          "drawing_count": drawing_count,
          "scanned_like": scanned_like,
          "sparse_text": sparse_text,
      })

    doc.close()
    sampled_pages = len(pages)
    text_ratio = text_pages / sampled_pages if sampled_pages else 0
    scanned_ratio = len(scanned_like_pages) / sampled_pages if sampled_pages else 0
    sparse_text_ratio = len(sparse_text_pages) / sampled_pages if sampled_pages else 0
    avg_text_chars = sum(p.get("text_chars", 0) for p in pages) / sampled_pages if sampled_pages else 0
    max_text_chars = max((p.get("text_chars", 0) for p in pages), default=0)
    has_images = image_pages > 0
    if scanned_ratio >= 0.6 or (sampled_pages >= 10 and avg_text_chars < 160 and max_text_chars < 700):
        route = "vision_or_ocr"
    elif scanned_like_pages or (has_images and text_ratio < 0.8) or (sampled_pages >= 10 and sparse_text_ratio >= 0.5):
        route = "hybrid_text_plus_vision"
    else:
        route = "text_extraction"

    ocr_candidate_pages = sorted(set(scanned_like_pages) | set(
        sparse_text_pages if sampled_pages >= 10 and avg_text_chars < 160 else []
    ))

    result = {
        "filename": input_pdf.name,
        "page_count": total_pages,
        "sampled_pages": sampled_pages,
        "text_pages": text_pages,
        "low_text_pages": low_text_pages,
        "sparse_text_pages": sparse_text_pages,
        "sparse_text_ratio": sparse_text_ratio,
        "avg_text_chars": avg_text_chars,
        "max_text_chars": max_text_chars,
        "image_pages": image_pages,
        "scanned_like_pages": scanned_like_pages,
        "ocr_candidate_pages": ocr_candidate_pages,
        "likely_scanned_or_ocr": bool(route in {"vision_or_ocr", "hybrid_text_plus_vision"} and ocr_candidate_pages),
        "recommended_route": route,
        "notes": {
            "text_extraction": "Use extracted text and chunks for normal reading, summary, and Q&A.",
            "hybrid_text_plus_vision": "Use MinerU/OCR or visual reading when pages have sparse extracted text, scanned residue, figures, or screenshots.",
            "vision_or_ocr": "Most sampled pages have insufficient effective text; use MinerU/OCR even if scanned_like_pages is empty.",
        },
        "pages": pages,
    }
    _write_json(output, result)
    return result


def pdf_extract_pages(input_pdf, output="pdf_pages.jsonl", max_pages=None, include_tables=True):
    """Extract page-level text, image counts, and best-effort tables into JSONL."""
    import fitz

    input_pdf = _as_path(input_pdf)
    doc = fitz.open(str(input_pdf))
    total_pages = doc.page_count
    page_limit = total_pages if max_pages is None else min(total_pages, int(max_pages))
    pdfplumber_pdf = None
    if include_tables:
        try:
            import pdfplumber

            pdfplumber_pdf = pdfplumber.open(str(input_pdf))
        except Exception:
            pdfplumber_pdf = None

    records = []
    _ensure_parent(output)
    with open(output, "w", encoding="utf-8") as f:
        for index in range(page_limit):
            page = doc.load_page(index)
            text = _normalize_text(page.get_text("text"))
            image_count = len(page.get_images(full=True))
            tables = []
            if pdfplumber_pdf is not None:
                try:
                    for table in pdfplumber_pdf.pages[index].extract_tables() or []:
                        markdown = _table_to_markdown(table)
                        if markdown:
                            tables.append(markdown)
                except Exception:
                    tables = []
            record = {
                "page": index + 1,
                "text": text,
                "text_chars": len(text),
                "image_count": image_count,
                "table_count": len(tables),
                "tables_markdown": tables,
            }
            records.append(record)
            f.write(json.dumps(record, ensure_ascii=False, default=_json_default) + "\n")

    if pdfplumber_pdf is not None:
        pdfplumber_pdf.close()
    doc.close()
    return records


def pdf_build_reading_pack(
    input_pdf,
    output_prefix=None,
    max_pages=None,
    chunk_chars=4500,
    overlap=350,
    render_visual_pages=False,
    max_visual_pages=8,
    image_dpi=180,
    allow_mineru_redirect=True,
):
    """Create a page/chunk reading pack for long-PDF analysis.

    Use for long PDFs, mixed text/image PDFs, scanned-like pages, charts/screenshots,
    and page-cited Q&A. Set render_visual_pages=True only when visual page review is needed.

    Outputs:
    - <prefix>_profile.json: PDF type and routing decision.
    - <prefix>_pages.jsonl: page-level text/table/image metadata.
    - <prefix>_chunks.jsonl: chunked text with page ranges for retrieval.
    - <prefix>_reading_pack.md: human-readable index and usage notes.
    Optional: render scanned-like/low-text pages to PNG for Qwen3-VL review.
    """
    input_pdf = _as_path(input_pdf)
    prefix = output_prefix or input_pdf.stem
    profile_path = f"{prefix}_profile.json"
    pages_path = f"{prefix}_pages.jsonl"
    chunks_path = f"{prefix}_chunks.jsonl"
    index_path = f"{prefix}_reading_pack.md"

    profile = pdf_profile(input_pdf, profile_path, max_pages=max_pages)
    should_use_mineru, mineru_reasons = _pdf_should_use_mineru(profile)
    if _pdf_mineru_first_enabled():
        should_use_mineru = True
        mineru_reasons = ["default PDF policy: MinerU first"] + list(mineru_reasons or [])
    if allow_mineru_redirect and should_use_mineru and _mineru_parse_url():
        try:
            mineru_result = mineru_parse_pdf(
                input_pdf,
                f"{prefix}_mineru",
                return_content_list=True,
                return_images=False,
                chunk_chars=chunk_chars,
                overlap=overlap,
            )
            mineru_result.update({
                "source": input_pdf.name,
                "route": "mineru_parse_pdf",
                "redirected_from": "pdf_build_reading_pack",
                "profile_path": _display_path(profile_path),
                "profile": profile,
                "routing_reasons": mineru_reasons,
                "note": (
                    "The default PDF policy is MinerU first, so pdf_build_reading_pack "
                    "redirected to MinerU. Read md_path or chunks_path; do not conclude from a text-only pack."
                ),
            })
            return mineru_result
        except Exception as exc:
            profile.setdefault("warnings", []).append(
                f"MinerU redirect failed, falling back to text reading pack: {type(exc).__name__}: {exc}"
            )
    pages = pdf_extract_pages(input_pdf, pages_path, max_pages=max_pages, include_tables=True)
    chunks = []
    for page_record in pages:
        page_text_parts = []
        if page_record.get("text"):
            page_text_parts.append(page_record["text"])
        for table in page_record.get("tables_markdown") or []:
            page_text_parts.append("表格：\n" + table)
        page_text = "\n\n".join(page_text_parts)
        for local_index, chunk in enumerate(_chunk_text(page_text, max_chars=chunk_chars, overlap=overlap), 1):
            chunks.append({
                "chunk_id": f"p{page_record['page']}-{local_index}",
                "page_start": page_record["page"],
                "page_end": page_record["page"],
                "text": chunk,
                "text_chars": len(chunk),
                "source": input_pdf.name,
            })

    with open(chunks_path, "w", encoding="utf-8") as f:
        for chunk in chunks:
            f.write(json.dumps(chunk, ensure_ascii=False, default=_json_default) + "\n")

    rendered_pages = []
    if render_visual_pages:
        visual_pages = profile.get("scanned_like_pages") or [
            p["page"] for p in profile.get("pages", []) if p.get("text_chars", 0) < 80 and p.get("image_count", 0) > 0
        ]
        visual_pages = visual_pages[:max_visual_pages]
        if visual_pages:
            import fitz

            doc = fitz.open(str(input_pdf))
            zoom = image_dpi / 72
            matrix = fitz.Matrix(zoom, zoom)
            for page_number in visual_pages:
                page = doc.load_page(page_number - 1)
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                image_path = f"{prefix}_page_{page_number:04d}.png"
                pix.save(image_path)
                rendered_pages.append(image_path)
            doc.close()

    lines = [
        f"# PDF Reading Pack: {input_pdf.name}",
        "",
        f"- Pages: {profile['page_count']}",
        f"- Recommended route: {profile['recommended_route']}",
        f"- Extracted chunks: {len(chunks)}",
        f"- Text pages in sample: {profile['text_pages']}/{profile['sampled_pages']}",
        f"- Image pages in sample: {profile['image_pages']}/{profile['sampled_pages']}",
        f"- Scanned-like pages: {', '.join(map(str, profile['scanned_like_pages'])) or 'None'}",
        f"- OCR candidate pages: {', '.join(map(str, profile.get('ocr_candidate_pages') or [])) or 'None'}",
        f"- Average extracted chars/page: {profile.get('avg_text_chars', 0):.1f}",
        f"- Max extracted chars/page: {profile.get('max_text_chars', 0)}",
        "",
        "## Files",
        f"- `{profile_path}`",
        f"- `{pages_path}`",
        f"- `{chunks_path}`",
    ]
    if rendered_pages:
        lines.append("- Rendered visual pages:")
        lines.extend(f"  - `{p}`" for p in rendered_pages)
    lines.extend([
        "",
        "## How to use",
        "- For normal summary/Q&A, read relevant records from the chunks JSONL and cite page numbers.",
        "- For scanned-like or figure-heavy pages, inspect the rendered page images with the vision model.",
        "- Do not load the entire PDF into the model context when the chunks file is large.",
    ])
    write_text(index_path, "\n".join(lines))

    return {
        "profile": profile_path,
        "pages": pages_path,
        "chunks": chunks_path,
        "index": index_path,
        "rendered_pages": rendered_pages,
        "chunk_count": len(chunks),
        "recommended_route": profile["recommended_route"],
    }


def _mineru_parse_url():
    explicit = os.environ.get("SANSUO_MINERU_PDF_PARSE_URL")
    if explicit:
        return explicit.rstrip("/")
    base = os.environ.get("SANSUO_MINERU_BASE_URL")
    if base:
        return base.rstrip("/") + "/pdf_parse"
    return None


def _pdf_mineru_first_enabled():
    explicit = str(os.environ.get("SANSUO_PDF_MINERU_FIRST", "")).strip().lower()
    if explicit in {"false", "0", "no", "off"}:
        return False
    return True


def _multipart_form_data(fields, file_field, file_path):
    import uuid

    boundary = "----SansuoMinerU" + uuid.uuid4().hex
    body = bytearray()

    def add_line(value=b""):
        if isinstance(value, str):
            value = value.encode("utf-8")
        body.extend(value)
        body.extend(b"\r\n")

    for name, value in fields.items():
        add_line(f"--{boundary}")
        add_line(f'Content-Disposition: form-data; name="{name}"')
        add_line()
        add_line(str(value))

    file_path = _as_path(file_path)
    add_line(f"--{boundary}")
    add_line(f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"')
    add_line("Content-Type: application/pdf")
    add_line()
    body.extend(file_path.read_bytes())
    body.extend(b"\r\n")
    add_line(f"--{boundary}--")
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def _mineru_content_item_text(item):
    if isinstance(item, str):
        return item.strip()
    if not isinstance(item, dict):
        return ""
    parts = []
    for key in ("text", "content", "md", "markdown", "table_body", "html"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
    for key in ("captions", "image_caption", "footnotes"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
        elif isinstance(value, list):
            parts.extend(str(entry).strip() for entry in value if str(entry).strip())
    return "\n\n".join(dict.fromkeys(parts))


def _mineru_content_item_page(item):
    if not isinstance(item, dict):
        return None
    if item.get("page") is not None:
        value = item.get("page")
    elif item.get("page_no") is not None:
        value = item.get("page_no")
    elif item.get("page_number") is not None:
        value = item.get("page_number")
    elif item.get("page_idx") is not None:
        try:
            return int(item.get("page_idx")) + 1
        except (TypeError, ValueError):
            return None
    else:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _mineru_page_aware_chunks(content_list, source_name, chunk_chars, overlap):
    page_parts = []
    for item in content_list or []:
        text = _mineru_content_item_text(item)
        if not text:
            continue
        page = _mineru_content_item_page(item)
        if page_parts and page_parts[-1][0] == page:
            page_parts[-1][1].append(text)
        else:
            page_parts.append([page, [text]])

    chunks = []
    for page, parts in page_parts:
        page_text = "\n\n".join(parts)
        for local_index, chunk in enumerate(
            _chunk_text(page_text, max_chars=chunk_chars, overlap=overlap), 1
        ):
            record = {
                "chunk_id": f"mineru-p{page}-{local_index}" if page else f"mineru-{len(chunks) + 1}",
                "text": chunk,
                "text_chars": len(chunk),
                "source": source_name,
            }
            if page:
                record["page_start"] = page
                record["page_end"] = page
            chunks.append(record)
    return chunks


def mineru_parse_pdf(
    input_pdf,
    output_prefix=None,
    return_content_list=True,
    return_images=False,
    timeout=None,
    chunk_chars=4500,
    overlap=350,
):
    """Parse a PDF with the optional internal MinerU API."""
    input_pdf = _as_path(input_pdf)
    url = _mineru_parse_url()
    if not url:
        raise RuntimeError(
            "MinerU API is not configured. Set SANSUO_MINERU_PDF_PARSE_URL or SANSUO_MINERU_BASE_URL."
        )

    prefix = output_prefix or f"{input_pdf.stem}_mineru"
    timeout_seconds = timeout
    if timeout_seconds is None:
        timeout_seconds = int(os.environ.get("SANSUO_MINERU_TIMEOUT_MS", "600000")) / 1000

    fields = {
        "return_content_list": "true" if return_content_list else "false",
        "return_images": "true" if return_images else "false",
    }
    body, content_type = _multipart_form_data(fields, "pdf_file", input_pdf)
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": content_type, "Accept": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            raw_text = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"MinerU API HTTP {error.code}: {details}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"MinerU API request failed: {error}") from error

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError as error:
        raw_path = f"{prefix}_raw_response.txt"
        _ensure_parent(raw_path)
        Path(raw_path).write_text(raw_text, encoding="utf-8")
        raise RuntimeError(f"MinerU API returned non-JSON response; saved to {raw_path}") from error

    raw_json_path = f"{prefix}_result.json"
    md_path = f"{prefix}.md"
    content_list_path = f"{prefix}_content_list.json"
    chunks_path = f"{prefix}_chunks.jsonl"

    md_content = result.get("md_content") or result.get("markdown") or result.get("md") or ""
    content_list = result.get("content_list") or []
    if isinstance(content_list, str):
        content_list = [content_list]
    if not isinstance(content_list, list):
        content_list = [content_list]

    _write_json(raw_json_path, result)
    Path(md_path).write_text(str(md_content), encoding="utf-8")
    _write_json(content_list_path, content_list)

    source_text = str(md_content).strip()
    if not source_text and content_list:
        source_text = "\n\n".join(
            json.dumps(item, ensure_ascii=False, default=_json_default)
            if not isinstance(item, str)
            else item
            for item in content_list
        )

    chunks = _mineru_page_aware_chunks(content_list, input_pdf.name, chunk_chars, overlap)
    content_list_chars = sum(len(chunk.get("text") or "") for chunk in chunks)
    # Some MinerU-compatible services return a sparse content_list. In that case
    # the Markdown remains the authoritative complete text and must not be lost.
    if not chunks or (source_text and content_list_chars < len(source_text) * 0.5):
        chunks = []
        for index, chunk in enumerate(
            _chunk_text(source_text, max_chars=chunk_chars, overlap=overlap), 1
        ):
            chunks.append({
                "chunk_id": f"mineru-{index}",
                "text": chunk,
                "text_chars": len(chunk),
                "source": input_pdf.name,
            })

    with open(chunks_path, "w", encoding="utf-8") as f:
        for chunk in chunks:
            f.write(json.dumps(chunk, ensure_ascii=False, default=_json_default) + "\n")

    return {
        "source": input_pdf.name,
        "raw_json_path": _display_path(raw_json_path),
        "md_path": _display_path(md_path),
        "content_list_path": _display_path(content_list_path),
        "chunks_path": _display_path(chunks_path),
        "content_list_count": len(content_list),
        "md_chars": len(str(md_content)),
        "chunk_count": len(chunks),
        "return_images": bool(return_images),
    }


def _pdf_text_stats(profile):
    pages = profile.get("pages") or []
    counts = []
    for page in pages:
        try:
            counts.append(int(page.get("text_chars") or 0))
        except Exception:
            counts.append(0)
    sampled = len(counts)
    total = sum(counts)
    avg = total / sampled if sampled else 0
    non_empty = [count for count in counts if count > 0]
    return {
        "sampled": sampled,
        "total_chars": total,
        "avg_chars": avg,
        "max_chars": max(counts) if counts else 0,
        "non_empty_pages": len(non_empty),
    }


def _looks_like_watermark_only_text(text):
    text = _normalize_text(text)
    if not text:
        return False
    compact = re.sub(r"\s+", "", text)
    if len(compact) <= 12:
        return True
    watermark_tokens = [
        "保密",
        "秘密",
        "机密",
        "绝密",
        "内部",
        "水印",
        "confidential",
        "secret",
        "draft",
    ]
    lowered = compact.lower()
    return len(compact) <= 80 and any(token in lowered for token in watermark_tokens)


def _pdf_should_use_mineru(profile, prefer_mineru_for_images=True, scanned_ratio_threshold=0.3):
    """Return (should_use_mineru, reasons) for a pdf_profile result."""
    reasons = []
    route = str(profile.get("recommended_route") or "").lower()
    page_count = int(profile.get("sampled_pages") or profile.get("page_count") or 0)
    scanned_pages = profile.get("scanned_like_pages") or []
    image_pages = int(profile.get("image_pages") or 0)
    low_text_pages = int(profile.get("low_text_pages") or 0)
    text_pages = int(profile.get("text_pages") or 0)
    page_stats = _pdf_text_stats(profile)
    scanned_ratio = len(scanned_pages) / page_count if page_count else 0
    low_text_ratio = low_text_pages / page_count if page_count else 0
    image_ratio = image_pages / page_count if page_count else 0
    text_ratio = text_pages / page_count if page_count else 0

    if any(token in route for token in ("vision", "ocr", "scan")):
        reasons.append(f"recommended_route={profile.get('recommended_route')}")
    if scanned_ratio >= scanned_ratio_threshold:
        reasons.append(f"scanned_like_pages_ratio={scanned_ratio:.2f}")
    if low_text_ratio >= 0.5 and image_pages > 0:
        reasons.append(f"low_text_pages_ratio={low_text_ratio:.2f} with images")
    if prefer_mineru_for_images and image_ratio >= 0.5 and text_ratio < 0.8:
        reasons.append(f"image_pages_ratio={image_ratio:.2f}, text_pages_ratio={text_ratio:.2f}")
    if page_count and text_pages == 0 and (image_pages > 0 or low_text_pages > 0):
        reasons.append("no text pages detected in sampled pages")
    if page_count >= 10 and page_stats["avg_chars"] < 120 and page_stats["max_chars"] < 500:
        reasons.append(
            f"long low-text PDF: page_count={page_count}, avg_chars={page_stats['avg_chars']:.1f}, max_chars={page_stats['max_chars']}"
        )
    if page_count >= 10 and low_text_ratio >= 0.35 and text_ratio <= 0.65:
        reasons.append(f"long mixed/low-text PDF: low_text_ratio={low_text_ratio:.2f}, text_pages_ratio={text_ratio:.2f}")
    return bool(reasons), reasons


def _pdf_preview_indicates_mineru_needed(preview_text, profile):
    text = _normalize_text(preview_text)
    page_count = int(profile.get("page_count") or profile.get("sampled_pages") or 0)
    if not page_count:
        return False, []
    compact = re.sub(r"\s+", "", text)
    reasons = []
    if page_count >= 10 and len(compact) < min(2000, page_count * 120):
        reasons.append(f"reading_pack_preview_too_short={len(compact)} chars for {page_count} pages")
    if page_count >= 10 and _looks_like_watermark_only_text(compact[:500]):
        reasons.append("reading_pack_preview_looks_like_watermark_only")
    return bool(reasons), reasons


def _read_jsonl_preview(path, max_records=6, max_chars=12000):
    path = Path(path)
    if not path.exists():
        return "", {"path": str(path), "records": 0, "exists": False}
    parts = []
    records = 0
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if records >= max_records or sum(len(part) for part in parts) >= max_chars:
                break
            line = line.strip()
            if not line:
                continue
            records += 1
            try:
                item = json.loads(line)
                page = item.get("page") or item.get("page_start") or item.get("page_idx")
                chunk_id = item.get("chunk_id") or f"record-{records}"
                text = item.get("text") or item.get("content") or item.get("md") or ""
                header = f"[{chunk_id}]"
                if page:
                    header += f" page={page}"
                parts.append(f"{header}\n{str(text).strip()}")
            except Exception:
                parts.append(line)
    preview = "\n\n".join(part for part in parts if part).strip()
    return preview[:max_chars], {
        "path": str(path),
        "records": records,
        "exists": True,
        "truncated": len(preview) > max_chars,
    }


def _read_text_preview(path, max_chars=12000):
    path = Path(path)
    if not path.exists():
        return "", {"path": str(path), "exists": False, "chars": 0}
    text = path.read_text(encoding="utf-8", errors="replace")
    return text[:max_chars], {
        "path": str(path),
        "exists": True,
        "chars": len(text),
        "truncated": len(text) > max_chars,
    }


def _read_jsonl_records(path):
    records = []
    path = Path(path)
    if not path.exists():
        return records
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for index, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except Exception:
                record = {"text": line}
            record["_record_index"] = index
            records.append(record)
    return records


def _pdf_result_chunks_path(value):
    if not value:
        return None
    if isinstance(value, (str, os.PathLike)):
        path = Path(value)
        if path.suffix.lower() == ".json":
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                return _pdf_result_chunks_path(data)
            except Exception:
                return path
        return path
    if isinstance(value, dict):
        primary = value.get("primary_result") if isinstance(value.get("primary_result"), dict) else value
        return (
            primary.get("chunks_path")
            or primary.get("chunks")
            or primary.get("pages")
            or value.get("chunks_path")
            or value.get("chunks")
        )
    return None


def _query_terms(query):
    text = str(query or "").strip().lower()
    if not text:
        return []
    terms = re.findall(r"[\w\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2,}", text)
    seen = []
    for term in terms:
        if term not in seen:
            seen.append(term)
    return seen or [text]


def read_pdf_find(source, query, top_k=6, neighbors=1, max_chars=16000):
    """Find relevant PDF chunks for detail Q&A.

    source may be a read_pdf_smart manifest dict, a manifest JSON path, or a chunks
    JSONL path. This is a lightweight lexical finder; use it to gather candidate
    chunks, then answer from the returned context_text.
    """
    chunks_path = _pdf_result_chunks_path(source)
    if not chunks_path:
        raise ValueError("Could not determine chunks path from source. Pass read_pdf_smart result or a chunks JSONL path.")
    chunks_path = Path(chunks_path)
    records = _read_jsonl_records(chunks_path)
    terms = _query_terms(query)
    scored = []
    for index, record in enumerate(records):
        text = str(record.get("text") or record.get("content") or record.get("md") or record)
        lowered = text.lower()
        score = 0
        matched_terms = []
        for term in terms:
            count = lowered.count(term.lower())
            if count:
                matched_terms.append(term)
                score += count * (3 if len(term) >= 4 else 2)
        if score:
            scored.append((score, index, matched_terms, record))

    scored.sort(key=lambda item: (-item[0], item[1]))
    selected_indexes = set()
    direct_hits = []
    for score, index, matched_terms, record in scored[: max(1, int(top_k or 6))]:
        direct_hits.append({
            "score": score,
            "index": index,
            "chunk_id": record.get("chunk_id") or f"record-{index + 1}",
            "page_start": record.get("page_start") or record.get("page") or record.get("page_idx"),
            "page_end": record.get("page_end") or record.get("page") or record.get("page_idx"),
            "matched_terms": matched_terms,
        })
        for offset in range(-max(0, int(neighbors or 0)), max(0, int(neighbors or 0)) + 1):
            neighbor_index = index + offset
            if 0 <= neighbor_index < len(records):
                selected_indexes.add(neighbor_index)

    context_parts = []
    selected_records = []
    for index in sorted(selected_indexes):
        record = records[index]
        text = str(record.get("text") or record.get("content") or record.get("md") or record).strip()
        chunk_id = record.get("chunk_id") or f"record-{index + 1}"
        page_start = record.get("page_start") or record.get("page") or record.get("page_idx")
        page_end = record.get("page_end") or page_start
        label = f"[{chunk_id}]"
        if page_start:
            label += f" pages={page_start}" if page_start == page_end else f" pages={page_start}-{page_end}"
        context_parts.append(f"{label}\n{text}")
        selected_records.append({
            "index": index,
            "chunk_id": chunk_id,
            "page_start": page_start,
            "page_end": page_end,
            "text": text,
        })

    context_text = "\n\n".join(context_parts).strip()
    return {
        "query": query,
        "chunks_path": _display_path(chunks_path),
        "terms": terms,
        "total_records": len(records),
        "direct_hits": direct_hits,
        "selected_records": selected_records,
        "context_text": context_text[: max(1000, int(max_chars or 16000))],
        "truncated": len(context_text) > max(1000, int(max_chars or 16000)),
        "note": "If context_text is empty or insufficient, broaden query terms, increase top_k/neighbors, or read the PDF in batches.",
    }


def _build_pdf_smart_preview(primary_result, route, max_records=6, max_chars=12000):
    primary_result = primary_result or {}
    route = str(route or "")
    candidates = []
    if "mineru" in route:
        candidates.extend([
            ("mineru_chunks", primary_result.get("chunks_path"), "jsonl"),
            ("mineru_md", primary_result.get("md_path"), "text"),
            ("mineru_content_list", primary_result.get("content_list_path"), "text"),
        ])
    else:
        candidates.extend([
            ("reading_pack_chunks", primary_result.get("chunks"), "jsonl"),
            ("reading_pack_pages", primary_result.get("pages"), "jsonl"),
            ("reading_pack_index", primary_result.get("index"), "text"),
        ])

    for source, path, kind in candidates:
        if not path:
            continue
        if kind == "jsonl":
            preview, meta = _read_jsonl_preview(path, max_records=max_records, max_chars=max_chars)
        else:
            preview, meta = _read_text_preview(path, max_chars=max_chars)
        if preview:
            meta["source"] = source
            return preview, meta
    return "", {"source": None, "exists": False}


def _pdf_followup_source_hint(primary_result, manifest_path):
    primary_result = primary_result or {}
    candidates = [
        ("smart_manifest", manifest_path),
        ("mineru_chunks", primary_result.get("chunks_path")),
        ("mineru_content_list", primary_result.get("content_list_path")),
        ("mineru_md", primary_result.get("md_path")),
        ("reading_pack_chunks", primary_result.get("chunks")),
        ("reading_pack_pages", primary_result.get("pages")),
        ("reading_pack_index", primary_result.get("index")),
    ]
    for source_type, source_path in candidates:
        if source_path:
            return {
                "source_type": source_type,
                "path": _display_path(source_path),
                "recommended_reader": "read_pdf_find" if "chunks" in source_type or "manifest" in source_type or "content_list" in source_type else "read_file_auto",
            }
    return {"source_type": None, "path": None, "recommended_reader": "read_file_auto"}


def read_pdf_smart(
    input_pdf,
    output_prefix=None,
    batch_pages=10,
    preview_records=6,
    preview_chars=12000,
    prefer_mineru_for_images=True,
    mineru_return_content_list=True,
    mineru_return_images=False,
    fallback_render_visual_pages=True,
    max_visual_pages=8,
    chunk_chars=4500,
    overlap=350,
):
    """Profile a PDF, then route it to MinerU or the normal reading pack.

    Recommended first-choice helper for uploaded PDFs:
    - MinerU configured -> mineru_parse_pdf first
    - MinerU unavailable or failed -> pdf_build_reading_pack fallback

    The returned manifest records the chosen route and output file names so later
    turns can explicitly reference those artifact names and let Code API auto-mount
    them into /mnt/data.
    """
    input_pdf = _as_path(input_pdf)
    prefix = output_prefix or f"{input_pdf.stem}_smart"
    profile_path = f"{prefix}_profile.json"
    manifest_path = f"{prefix}_smart_manifest.json"
    profile = pdf_profile(input_pdf, profile_path)
    should_use_mineru, reasons = _pdf_should_use_mineru(
        profile,
        prefer_mineru_for_images=prefer_mineru_for_images,
    )
    mineru_configured = bool(_mineru_parse_url())
    mineru_first = _pdf_mineru_first_enabled()
    if mineru_first:
        should_use_mineru = True
        reasons = ["default PDF policy: MinerU first"] + list(reasons or [])

    route = "pdf_build_reading_pack"
    primary_result = None
    fallback_result = None
    errors = []

    if should_use_mineru and mineru_configured:
        try:
            route = "mineru_parse_pdf"
            primary_result = mineru_parse_pdf(
                input_pdf,
                f"{prefix}_mineru",
                return_content_list=mineru_return_content_list,
                return_images=mineru_return_images,
                chunk_chars=chunk_chars,
                overlap=overlap,
            )
        except Exception as exc:
            errors.append(f"mineru_parse_pdf failed: {type(exc).__name__}: {exc}")
            route = "pdf_build_reading_pack_fallback"
    elif should_use_mineru and not mineru_configured:
        errors.append("MinerU is recommended by PDF profile but not configured.")
        route = "pdf_build_reading_pack_fallback"

    if primary_result is None:
        primary_result = pdf_build_reading_pack(
            input_pdf,
            f"{prefix}_pdf",
            chunk_chars=chunk_chars,
            overlap=overlap,
            render_visual_pages=bool(fallback_render_visual_pages and should_use_mineru),
            max_visual_pages=max_visual_pages,
            allow_mineru_redirect=False,
        )
    elif should_use_mineru:
        # Keep a lightweight normal profile/pages/chunks fallback only when the caller
        # explicitly needs non-MinerU page metadata later. Avoid doing this by default
        # to prevent duplicate heavy processing.
        fallback_result = None

    batch_pages = max(1, int(batch_pages or 10))
    page_count = int(profile.get("page_count") or 0)
    effective_preview_records = max(1, int(preview_records or 6))
    effective_preview_chars = max(1000, int(preview_chars or 12000))
    if page_count and page_count <= batch_pages:
        effective_preview_records = max(effective_preview_records, 80)
        effective_preview_chars = max(effective_preview_chars, 50000)
    preview_text, preview_meta = _build_pdf_smart_preview(
        primary_result,
        route,
        max_records=effective_preview_records,
        max_chars=effective_preview_chars,
    )
    if route == "pdf_build_reading_pack" and mineru_configured:
        fallback_needed, fallback_reasons = _pdf_preview_indicates_mineru_needed(preview_text, profile)
        if fallback_needed:
            try:
                route = "mineru_parse_pdf_after_preview"
                reasons.extend(fallback_reasons)
                primary_result = mineru_parse_pdf(
                    input_pdf,
                    f"{prefix}_mineru",
                    return_content_list=mineru_return_content_list,
                    return_images=mineru_return_images,
                    chunk_chars=chunk_chars,
                    overlap=overlap,
                )
                preview_text, preview_meta = _build_pdf_smart_preview(
                    primary_result,
                    route,
                    max_records=effective_preview_records,
                    max_chars=effective_preview_chars,
                )
                should_use_mineru = True
            except Exception as exc:
                errors.append(f"mineru_parse_pdf fallback after short preview failed: {type(exc).__name__}: {exc}")

    manifest = {
        "source": input_pdf.name,
        "route": route,
        "profile_path": _display_path(profile_path),
        "profile": profile,
        "mineru_configured": mineru_configured,
        "mineru_first": mineru_first,
        "should_use_mineru": should_use_mineru,
        "routing_reasons": reasons,
        "primary_result": primary_result,
        "fallback_result": fallback_result,
        "errors": errors,
        "batch_pages": batch_pages,
        "preview_text": preview_text,
        "preview_meta": preview_meta,
        "short_pdf_full_preview": bool(page_count and page_count <= batch_pages),
        "preferred_followup_source": _pdf_followup_source_hint(primary_result, manifest_path),
        "next_step": (
            "Use preview_text for an immediate first answer. For deeper or full-document coverage, "
            "continue reading primary_result artifacts in batches in the same sandbox call; do not stop after creating chunks."
        ),
        "same_turn_followup_rule": (
            "If the current question asks for summary, page content, clauses, keywords, or other concrete PDF details, "
            "do not stop after preview_text. In the same sandbox run, continue with read_pdf_find(preferred_followup_source.path or manifest_path, query)."
        ),
        "usage": [
            "For follow-up turns, explicitly reference the artifact filenames in primary_result so Code API can auto-mount them back into /mnt/data.",
            "For the current turn, answer from preview_text first, then continue reading primary_result chunks/md/pages if the user asked for a full summary or detailed extraction.",
            "For MinerU route, read md_path or chunks_path in batches; do not search /mnt/data blindly.",
            "For reading_pack route, read chunks/pages/index files in page or chunk batches and maintain a cumulative summary.",
            f"For long PDFs, process about {batch_pages} pages per batch and state covered page ranges.",
        ],
    }
    _write_json(manifest_path, manifest)
    manifest["manifest_path"] = _display_path(manifest_path)
    return manifest


def _draw_pdf_lines(lines, output="output.pdf", title=None, font_size=12, margin=42):
    """Write plain lines to a PDF with the default SanSuo fonts."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas

    cjk_font, _latin_font = _register_reportlab_fonts()
    _ensure_parent(output)
    page_size = landscape(A4) if any(len(str(line)) > 90 for line in lines) else A4
    c = canvas.Canvas(str(output), pagesize=page_size)
    width, height = page_size
    y = height - margin
    line_height = font_size * 1.45
    max_chars = max(18, int((width - margin * 2) / (font_size * 0.58)))

    if title:
        _pdf_draw_mixed_string(
            c,
            width / 2,
            y,
            str(title),
            cjk_font,
            latin_font,
            font_size + 8,
            align="center",
        )
        y -= line_height * 2

    for raw_line in lines:
        wrapped = textwrap.wrap(str(raw_line), width=max_chars, replace_whitespace=False) or [""]
        for line in wrapped:
            if y < margin:
                c.showPage()
                y = height - margin
            _pdf_draw_mixed_string(c, margin, y, line, cjk_font, latin_font, font_size)
            y -= line_height
    c.save()
    return str(output)


def docx_to_pdf_fallback(input_path, output="output.pdf"):
    """Best-effort DOCX to PDF without LibreOffice. Preserves readable text, not exact layout."""
    text = read_docx(input_path)
    return create_pdf(text, output, title=Path(input_path).stem)


def xlsx_to_pdf_fallback(input_path, output="output.pdf", max_rows=120):
    """Best-effort XLSX to PDF without LibreOffice. Renders sheet rows as tab-separated text."""
    data = read_xlsx(input_path, max_rows=max_rows)
    lines = []
    for sheet_name, rows in data.items():
        lines.append(f"【{sheet_name}】")
        for row in rows:
            lines.append("    ".join("" if value is None else str(value) for value in row))
        lines.append("")
    return _draw_pdf_lines(lines, output, title=Path(input_path).stem, font_size=10)


def pptx_to_pdf_fallback(input_path, output="output.pdf"):
    """Best-effort PPTX to PDF without LibreOffice. Renders slide text, not visual layout."""
    text = read_pptx(input_path)
    return create_pdf(text, output, title=Path(input_path).stem)


def read_csv(path, max_rows=200):
    with open(path, newline="", encoding="utf-8-sig", errors="ignore") as f:
        return [row for _, row in zip(range(max_rows), csv.reader(f))]


def read_file_auto(path):
    """Automatically read a supported file based on extension.

    Supports txt/md/code/json/csv/pdf/docx/xlsx/pptx/doc/xls where dependencies exist.
    Use as the first choice when the user uploads a file and asks to read, summarize,
    inspect, convert, or answer questions about it.
    """
    suffix = Path(path).suffix.lower()
    if suffix in {".txt", ".md", ".py", ".js", ".ts", ".html", ".css", ".json"}:
        text = read_text(path)
        if suffix == ".json":
            try:
                return json.loads(text)
            except Exception:
                return text
        return text
    if suffix == ".csv":
        return read_csv(path)
    if suffix == ".doc":
        return read_doc(path)
    if suffix == ".docx":
        return read_docx(path)
    if suffix == ".xls":
        return read_xls(path)
    if suffix == ".xlsx":
        return read_xlsx(path)
    if suffix == ".pptx":
        return read_pptx(path)
    if suffix == ".pdf":
        return read_pdf(path)
    raise ValueError(f"Unsupported file type: {suffix}")


def image_info(path):
    from PIL import Image

    with Image.open(path) as img:
        return {"format": img.format, "size": img.size, "mode": img.mode}


def make_zip(paths, output="output.zip"):
    _ensure_parent(output)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in paths:
            p = Path(item)
            if p.is_dir():
                for sub in p.rglob("*"):
                    if sub.is_file():
                        zf.write(sub, sub.relative_to(p.parent))
            elif p.is_file():
                zf.write(p, p.name)
    return str(output)


def _pdf_snapshot(directory):
    snapshot = {}
    for item in Path(directory).glob("*.pdf"):
        try:
            stat = item.stat()
        except OSError:
            continue
        snapshot[item.resolve()] = (stat.st_mtime_ns, stat.st_size)
    return snapshot


def _pick_generated_pdf(output_dir, input_stem, before_snapshot):
    output_dir = Path(output_dir)
    exact = output_dir / f"{input_stem}.pdf"
    if exact.exists() and exact.stat().st_size > 0:
        return exact

    after = _pdf_snapshot(output_dir)
    new_or_changed = []
    for path, marker in after.items():
        if marker[1] <= 0:
            continue
        if path not in before_snapshot or before_snapshot[path] != marker:
            new_or_changed.append(Path(path))

    if new_or_changed:
        stem_lower = input_stem.lower()
        new_or_changed.sort(
            key=lambda p: (
                0 if p.stem.lower().startswith(stem_lower) else 1,
                -p.stat().st_mtime_ns,
            )
        )
        return new_or_changed[0]

    candidates = [p for p in output_dir.glob(f"{input_stem}*.pdf") if p.stat().st_size > 0]
    if candidates:
        candidates.sort(key=lambda p: -p.stat().st_mtime_ns)
        return candidates[0]

    return None


def convert_office_to_pdf(input_path, output_dir=".", timeout=180):
    """Convert Office files to PDF while preserving layout.

    Supports doc/docx/xls/xlsx/ppt/pptx/rtf/odt/ods/odp when LibreOffice is available.
    Uses LibreOffice when available for layout fidelity. If the sandbox image has not
    been built with LibreOffice yet, falls back to readable pure-Python conversion
    for DOCX/XLSX/PPTX.

    The second argument accepts either an output directory or a concrete
    ``.pdf`` output path. The latter keeps model-generated code intuitive and
    avoids accidental ``name.pdf/name.pdf`` nested outputs.
    """
    input_path = _as_path(input_path).resolve()
    output_target = _as_path(output_dir).resolve()
    wants_explicit_pdf = output_target.suffix.lower() == ".pdf"
    output_dir = output_target.parent if wants_explicit_pdf else output_target
    output_dir.mkdir(parents=True, exist_ok=True)
    _prepare_office_fonts()
    if _has_binary("libreoffice", "soffice"):
        soffice = _require_binary("libreoffice", "soffice")
        before = _pdf_snapshot(output_dir)
        cmd = [
            soffice,
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            "--convert-to",
            "pdf",
            "--outdir",
            str(output_dir),
            str(input_path),
        ]
        result = _run_completed(cmd, timeout=timeout)
        if result.returncode != 0:
            raise RuntimeError(
                "LibreOffice conversion failed: "
                + " ".join(map(str, cmd))
                + "\nSTDOUT:\n"
                + (result.stdout or "")
                + "\nSTDERR:\n"
                + (result.stderr or "")
            )
        output = _pick_generated_pdf(output_dir, input_path.stem, before)
        if output is None:
            listing = "\n".join(
                f"{p.name}\t{p.stat().st_size} bytes" for p in sorted(output_dir.glob("*"))
            )
            raise RuntimeError(
                f"LibreOffice did not create a non-empty PDF for {input_path}"
                + "\nSTDOUT:\n"
                + (result.stdout or "")
                + "\nSTDERR:\n"
                + (result.stderr or "")
                + "\nOUTPUT_DIR:\n"
                + (listing or "(empty)")
            )
        if wants_explicit_pdf and output.resolve() != output_target.resolve():
            shutil.copyfile(output, output_target)
            output = output_target
        if not output.exists() or output.stat().st_size <= 0:
            raise RuntimeError(f"PDF output is missing or empty: {output}")
        return _display_path(output)

    output = output_target if wants_explicit_pdf else output_dir / (input_path.stem + ".pdf")
    suffix = input_path.suffix.lower()
    if suffix == ".docx":
        return _display_path(docx_to_pdf_fallback(input_path, output))
    if suffix == ".xlsx":
        return _display_path(xlsx_to_pdf_fallback(input_path, output))
    if suffix == ".pptx":
        return _display_path(pptx_to_pdf_fallback(input_path, output))
    if suffix == ".rtf":
        return _display_path(create_pdf(read_text(input_path), output, title=input_path.stem))
    raise RuntimeError(
        f"LibreOffice is not available in this sandbox image, and no pure-Python fallback exists for {suffix}."
    )


def convert_to_pdf(input_path, output="output.pdf"):
    """Best-effort conversion to PDF."""
    suffix = Path(input_path).suffix.lower()
    if suffix in {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf"}:
        generated = Path(convert_office_to_pdf(input_path, output))
        if generated.resolve() != Path(output).resolve():
            _ensure_parent(output)
            shutil.copyfile(generated, output)
        return str(output)
    if suffix in {".txt", ".md", ".csv", ".json"}:
        return create_pdf(read_text(input_path), output)
    if suffix in {".html", ".htm"}:
        return html_to_pdf(input_path, output)
    if suffix == ".pdf":
        if Path(input_path).resolve() != Path(output).resolve():
            _ensure_parent(output)
            shutil.copyfile(input_path, output)
        return str(output)
    raise ValueError(f"Unsupported conversion to PDF: {suffix}")


def html_to_pdf(input_path, output="output.pdf"):
    """Convert HTML to PDF. Uses LibreOffice when available, otherwise plain text fallback."""
    try:
        return convert_office_to_pdf(input_path, Path(output).parent or ".")
    except Exception:
        from bs4 import BeautifulSoup

        html = read_text(input_path)
        text = BeautifulSoup(html, "html.parser").get_text("\n")
        return create_pdf(text, output)


def pdf_to_images(input_pdf, output_prefix="page", fmt="png", dpi=180):
    """Convert PDF pages to images with poppler pdftoppm."""
    pdftoppm = _require_binary("pdftoppm")
    output_prefix = str(output_prefix)
    _ensure_parent(output_prefix + "." + fmt)
    _run([pdftoppm, f"-{fmt}", "-r", str(dpi), str(input_pdf), output_prefix], timeout=180)
    return sorted(str(p) for p in Path(".").glob(Path(output_prefix).name + f"-*.{fmt}"))


def image_convert(input_path, output="output.png", max_size=None, quality=90):
    from PIL import Image

    _ensure_parent(output)
    with Image.open(input_path) as img:
        if max_size:
            img.thumbnail(max_size)
        if img.mode in {"RGBA", "P"} and Path(output).suffix.lower() in {".jpg", ".jpeg"}:
            img = img.convert("RGB")
        img.save(output, quality=quality)
    return str(output)


def image_to_pdf(input_path, output="output.pdf"):
    from PIL import Image

    _ensure_parent(output)
    with Image.open(input_path) as img:
        if img.mode in {"RGBA", "P"}:
            img = img.convert("RGB")
        img.save(output, "PDF")
    return str(output)


def ocr_image(input_path, lang="chi_sim+eng", output_txt=None, timeout=120):
    """OCR an image with Tesseract. Returns text and optionally writes it."""
    tesseract = _require_binary("tesseract")
    result = subprocess.run(
        [tesseract, str(input_path), "stdout", "-l", lang],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    text = result.stdout
    if output_txt:
        write_text(output_txt, text)
    return text


def ocr_pdf(input_pdf, output_txt="ocr.txt", lang="chi_sim+eng", dpi=220):
    """OCR a scanned or image-only PDF into combined text.

    Use only when normal PDF text extraction is empty or insufficient. For normal PDFs,
    use read_pdf or pdf_build_reading_pack first.
    """
    image_paths = pdf_to_images(input_pdf, "ocr_page", fmt="png", dpi=dpi)
    parts = []
    for idx, image_path in enumerate(image_paths, 1):
        text = ocr_image(image_path, lang=lang)
        parts.append(f"--- Page {idx} ---\n{text}")
    combined = "\n\n".join(parts)
    write_text(output_txt, combined)
    return combined
