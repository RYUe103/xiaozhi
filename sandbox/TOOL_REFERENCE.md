# Sansuo Tools Reference

This file is the fuller reference for `sansuo_tools.py`. The runtime prompt should only carry the common tools. Use this file or `tool_reference()` when a less common helper is needed.

## Common Tools

### create_docx

Signature:

```python
create_docx(text, output="文件.docx", title=None)
```

Use for Word reports, plans, summaries, and formatted documents. `text` may be a string, dict, list, or markdown-ish text.

Correct examples:

```python
from sansuo_tools import create_docx

create_docx(
    {"篮球比赛策划书": "", "一、活动背景": "正文", "二、活动安排": "1. 时间\n2. 地点"},
    output="篮球比赛策划书.docx",
)

create_docx("一、活动背景\n正文", output="策划书.docx", title="策划书")
```

Do not hand-write `python-docx` unless the user explicitly needs complex custom layout.

### read_file_auto

Signature:

```python
read_file_auto(path)
```

Use first when the user uploads a supported file and asks to read, summarize, inspect, convert, or answer questions about it.

```python
from sansuo_tools import read_file_auto

content = read_file_auto("上传文件.pdf")
print(str(content)[:4000])
```

### read_xlsx

Signature:

```python
read_xlsx(path, max_rows=200, include_metadata=True)
```

Use for Excel Q&A. It returns sheet rows and metadata including sheet sizes, merged ranges, formulas, hidden rows/columns, and image/chart/table counts.

```python
from sansuo_tools import read_xlsx

data = read_xlsx("数据表.xlsx", max_rows=500)
print(data["_metadata"])
```

### read_pdf

Signature:

```python
read_pdf(path, max_chars=120000)
```

Use for normal text-based PDFs. For uploaded PDFs where you are not sure whether it is text, scanned, image-heavy, or complex, prefer `read_pdf_smart`.

### read_pdf_smart

Signature:

```python
read_pdf_smart(input_pdf, output_prefix=None, batch_pages=10)
```

First-choice helper for uploaded PDFs. In this deployment it uses MinerU first whenever MinerU is configured, then falls back to a normal reading pack only if MinerU is unavailable or fails.

- MinerU configured -> `mineru_parse_pdf`
- MinerU unavailable or failed -> `pdf_build_reading_pack(..., render_visual_pages=True)` fallback

It returns a manifest with `route`, `routing_reasons`, `profile`, `primary_result`, and artifact filenames. In follow-up turns, explicitly reference those artifact filenames so Code API can auto-mount them back into `/mnt/data`; do not blindly search `/mnt/data`.

It also returns `preview_text`. Use `preview_text` for the immediate first answer. If the user asks for full-document reading, detailed summary, or page-cited Q&A, continue reading `primary_result` chunks/md/pages in the same sandbox call; do not stop after saying chunks were generated.

For short PDFs (`page_count <= batch_pages`), `preview_text` is expanded to cover much more content and should normally be treated as the full first-pass reading material.

### read_pdf_find

Signature:

```python
read_pdf_find(source, query, top_k=6, neighbors=1)
```

Use for detail questions against a PDF reading pack or MinerU result. `source` may be the dict returned by `read_pdf_smart`, a smart manifest JSON path, or a chunks JSONL path. It returns direct hits, neighboring chunks, and `context_text`. Answer from `context_text`; if it is empty or insufficient, broaden query terms or read more chunks.

### docx_build_reading_pack

Signature:

```python
docx_build_reading_pack(input_docx, output_prefix=None, max_chars=120000, extract_images=True)
```

Use for Word files with screenshots, diagrams, charts, or embedded images. It extracts text blocks, image files, image positions, and nearby before/after text.

### pdf_build_reading_pack

Signature:

```python
pdf_build_reading_pack(input_pdf, output_prefix=None, max_pages=None, render_visual_pages=False)
```

Fallback reading-pack helper. Direct calls redirect to MinerU first when MinerU is configured. Set `render_visual_pages=True` only when MinerU is unavailable/failed and visual review is needed.

### mineru_parse_pdf

Signature:

```python
mineru_parse_pdf(input_pdf, output_prefix=None, return_content_list=True, return_images=False)
```

Use the optional internal MinerU API for scanned PDFs, image-heavy PDFs, and complex layout PDFs. Configure `SANSUO_MINERU_PDF_PARSE_URL=http://host:port/pdf_parse` or `SANSUO_MINERU_BASE_URL=http://host:port` first. It writes markdown, raw JSON, content-list JSON, and chunk JSONL files for batch reading.

### ocr_pdf

Signature:

```python
ocr_pdf(input_pdf, output_txt="ocr.txt", lang="chi_sim+eng", dpi=220)
```

Use only when normal PDF text extraction is empty or insufficient. It writes `output_txt` and returns combined OCR text.

### convert_office_to_pdf

Signature:

```python
convert_office_to_pdf(input_path, output_dir=".", timeout=180)
```

Use for layout-preserving Office-to-PDF conversion when LibreOffice is available. Supports doc/docx/xls/xlsx/ppt/pptx/rtf/odt/ods/odp. For simple one-call conversion to a specific path, `convert_to_pdf(input_path, output)` is also available.

## Generation Tools

- `write_text(path, content, encoding="utf-8")`
- `create_pdf(text, output="output.pdf", title=None, font_size=16, margin=72)`; correct example: `create_pdf("正文内容", output="策划书.pdf", title="篮球活动策划书")`. Do not call `create_pdf(title, content, filename)` or `create_pdf(title, filename, content)`.
- `create_xlsx(data, output="output.xlsx", sheet_name="Sheet1")`
- `create_pptx(title, bullets=None, output="output.pptx")`
- `create_line_chart(data, output="line_chart.png", x=None, y=None, title=None)`
- `create_bar_chart(data, output="bar_chart.png", x=None, y=None, title=None)`
- `create_pie_chart(data, output="pie_chart.png", labels=None, values=None, title=None)`
- `create_heatmap(data, output="heatmap.png", title=None)`
- `create_chart(chart_type, data, output=None, **kwargs)`
- `create_dashboard(data, output="dashboard.png", title=None)`
- `create_visual_report(data, output_prefix="visual_report")`

## Reading Tools

- `read_text(path, encoding="utf-8", max_chars=120000)`
- `read_docx(path, max_chars=120000)`
- `read_doc(path, max_chars=120000)`
- `read_xls(path, max_rows=200, include_metadata=True)`
- `read_pptx(path, max_chars=120000)`
- `read_csv(path, max_rows=200)`
- `docx_extract_blocks(input_docx, output_dir=None, max_chars=120000, extract_images=True)`
- `pdf_profile(input_pdf, output="pdf_profile.json", max_pages=None)`
- `pdf_extract_pages(input_pdf, output="pdf_pages.jsonl", max_pages=None, include_tables=True)`
- `read_pdf_smart(input_pdf, output_prefix=None, batch_pages=10)`
- `mineru_parse_pdf(input_pdf, output_prefix=None, return_content_list=True, return_images=False)`

## Conversion Tools

- `convert_to_pdf(input_path, output="output.pdf")`
- `html_to_pdf(input_path, output="output.pdf")`
- `docx_to_pdf_fallback(input_path, output="output.pdf")`
- `xlsx_to_pdf_fallback(input_path, output="output.pdf", max_rows=120)`
- `pptx_to_pdf_fallback(input_path, output="output.pdf")`
- `pdf_to_images(input_pdf, output_prefix="page", fmt="png", dpi=180)`

## Image, OCR, and Packaging Tools

- `image_info(path)`
- `image_convert(input_path, output="output.png", max_size=None, quality=90)`
- `image_to_pdf(input_path, output="output.pdf")`
- `ocr_image(input_path, lang="chi_sim+eng", output_txt=None, timeout=120)`
- `make_zip(paths, output="output.zip")`
- `tool_reference(name=None)`
