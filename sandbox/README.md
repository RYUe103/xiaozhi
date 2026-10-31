# SanSuo Local Code API

This is a small LibreChat-compatible Code API used for local testing. LibreChat
still calls its native `execute_code` tool; this service only provides the
`/v1/exec`, `/v1/upload`, `/v1/upload/batch`, and `/v1/download/...` endpoints.

All `/v1/*` routes require authentication. `/health` remains anonymous and
reports only whether authentication is configured. The recommended mode is a
short-lived LibreChat-signed JWT (`CODEAPI_AUTH_PROVIDER=librechat-jwt`); the
Code API host receives the public key only. `legacy-api-key` and `both` exist
for controlled migration, but still require `User-Id` and enforce tenant/user
ownership on every storage session. Requests with missing ownership metadata
are denied unless `CODEAPI_LEGACY_SESSION_POLICY=claim` is explicitly enabled
for a migration window.

Each storage session has a private `.session.json` ownership record. Download,
listing, freshness checks, input mounting, and output persistence validate this
record before accessing a file. Session/file identifiers are closed to safe
opaque characters, storage paths are resolved under the configured root, and
symlink objects are rejected.

Run:

```bash
npm run sandbox:serve
```

The API executes code in the Docker image configured by
`SANSUO_SANDBOX_IMAGE`, defaulting to `sansuo-python-sandbox:latest`.

Build the enhanced image when network access is stable:

```bash
npm run sandbox:build
```

The enhanced image adds LibreOffice, Poppler, and Tesseract. Without that build,
the existing lightweight image still supports pure-Python generation, reading,
and best-effort DOCX/XLSX/PPTX-to-PDF conversion.

Default document fonts are mounted into the sandbox from `sandbox/fonts/`:

- Chinese: `Songti.ttc`
- English/numbers: `TimesNewRoman.ttf`

The sandbox injects two helper modules into every Python run:

- `sitecustomize.py`: registers document fonts and prevents common ReportLab
  Chinese-glyph fallback issues.
- `sansuo_tools.py`: convenience helpers for creating, reading, converting, and
  packaging common files.

Examples:

```python
from sansuo_tools import create_pdf, create_docx, create_xlsx, create_pptx

create_pdf("我爱你\nI love you", "love.pdf", title="示例")
create_docx("季度报告正文", "report.docx", title="季度报告")
create_xlsx([{"项目": "收入", "金额": 100}], "data.xlsx")
create_pptx("汇报材料", ["进展", "问题", "下一步"], "slides.pptx")
```

Available helper capabilities:

- Generate: `create_pdf`, `create_docx`, `create_xlsx`, `create_pptx`,
  `write_text`, `make_zip`.
- Read: `read_file_auto`, `read_pdf`, `read_docx`, `read_xlsx`, `read_pptx`,
  `read_csv`, `image_info`. Legacy `.doc` and `.xls` reading is supported only
  when LibreOffice/soffice is installed, because those files must be converted
  to `.docx`/`.xlsx` before reliable extraction.
- DOCX visual pack: `docx_build_reading_pack`, which extracts text blocks,
  embedded images, and paragraph-level image anchors for optional VL review.
- Long PDF: `pdf_profile`, `pdf_extract_pages`, `pdf_build_reading_pack`.
- Convert: `convert_to_pdf`, `convert_office_to_pdf`, `html_to_pdf`,
  `image_convert`, `image_to_pdf`.
- Enhanced image only: high-fidelity Office-to-PDF via LibreOffice,
  `pdf_to_images`, `ocr_image`, `ocr_pdf`.

Output collection is recursive, but internal helper files are filtered. Limits
are configurable with:

- `SANSUO_MAX_OUTPUT_FILES`
- `SANSUO_MAX_OUTPUT_FILE_SIZE_MB`
- `SANSUO_MAX_TOTAL_OUTPUT_SIZE_MB`

DOCX files with embedded screenshots or diagrams should be handled in two
steps when visual understanding matters:

```python
from sansuo_tools import docx_build_reading_pack

pack = docx_build_reading_pack("input.docx", "input")
print(pack)
```

This creates `input_docx_reading_pack.md`, `input_docx_blocks.jsonl`,
`input_docx_manifest.json`, and `input_docx_assets/images/*`. Use the text
blocks for normal reading, and send only the extracted images that matter to
the VL model. Do not run full visual analysis for every DOCX by default.
