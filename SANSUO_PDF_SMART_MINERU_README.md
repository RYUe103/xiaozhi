# SanSuo PDF Smart MinerU Routing

## Purpose

This patch changes PDF handling from separate/manual routes to one MinerU-first route:

```text
uploaded PDF
-> read_pdf_smart()
-> pdf_profile()
-> mineru_parse_pdf() first when MinerU is configured
-> MinerU unavailable/failed: pdf_build_reading_pack(..., render_visual_pages=True)
```

## New Tool

```python
from pathlib import Path
from sansuo_tools import read_pdf_smart

pdf = Path('/mnt/data') / '文件.pdf'
pack = read_pdf_smart(pdf, '文件_smart', batch_pages=10)
print(pack['route'])
print(pack['primary_result'])
```

The returned manifest includes:

- `route`
- `routing_reasons`
- `profile`
- `primary_result`
- `preview_text`
- `preview_meta`
- `manifest_path`

For follow-up turns, explicitly reference the artifact filenames from `primary_result` so Code API can auto-mount them back into `/mnt/data`.

Each sandbox run now writes `/mnt/data/SANDBOX_AVAILABLE_FILES.json` when files are mounted. This file is an internal helper and is not returned as a user attachment. If a follow-up turn says "the previous file" or `/mnt/data` appears empty, read this manifest first and use the exact filename/path listed there. Do not blindly list or search `/mnt/data` and stop.

The `/mnt/data` copy is temporary. Uploaded files and persisted code artifacts remain in Code API storage; later sandbox runs can remount them when the code explicitly mentions the exact filename, for example:

```python
from pathlib import Path
from sansuo_tools import read_pdf_smart

pdf = Path('/mnt/data') / '原始文件名.pdf'
pack = read_pdf_smart(pdf, '原始文件名_smart', batch_pages=10)
```

For the current turn, answer from `preview_text` immediately. If the user asks for a full-document summary, detailed extraction, or page-cited Q&A, continue reading `primary_result` chunks/md/pages in the same sandbox call. Do not stop after saying chunks were generated.

For short PDFs where `page_count <= batch_pages`, `read_pdf_smart` sets `short_pdf_full_preview=true` and expands `preview_text`. Treat that preview as the full first-pass reading material unless the user asks for narrow evidence or exact page-by-page details.

For detail questions after a PDF has been parsed, use `read_pdf_find`:

```python
from sansuo_tools import read_pdf_smart, read_pdf_find

pdf = Path('/mnt/data') / '文件.pdf'
pack = read_pdf_smart(pdf, '文件_smart', batch_pages=10)
hits = read_pdf_find(pack, '付款 条款 发票', top_k=6, neighbors=1)
print(hits['context_text'])
```

`read_pdf_find` accepts a `read_pdf_smart` result, a `*_smart_manifest.json` path, or a chunks JSONL path. It returns candidate chunks plus neighboring chunks. If `context_text` is insufficient, broaden the query terms, increase `top_k/neighbors`, or read the relevant batch manually.

## Expected Behavior

- All uploaded PDFs use MinerU first when MinerU is configured, including normal text PDFs.
- MinerU unavailable or failed falls back to reading-pack chunks instead of failing immediately.
- Direct calls to `pdf_build_reading_pack` also redirect to MinerU first when MinerU is configured.
- Short PDFs are answered from expanded `preview_text` by default.
- Long PDFs are read in batches of about 10 pages.
- Detail follow-up questions use `read_pdf_find` against chunks instead of guessing from the first preview.
- The model should not blindly list `/mnt/data` after a sandbox run ends.
- The model should not call both `pdf_build_reading_pack` and `mineru_parse_pdf` unless MinerU fails and fallback is needed.
- The model should not answer "chunks were generated, please let me read them"; it should read the chunks or use `preview_text`.

## Verification

Inside `sansuo-code-api`:

```bash
docker exec sansuo-code-api sh -lc 'grep -n "def read_pdf_smart" /app/sandbox/sansuo_tools.py'
docker exec sansuo-code-api sh -lc 'grep -n "def read_pdf_find" /app/sandbox/sansuo_tools.py'
docker exec sansuo-code-api sh -lc 'grep -n "read_pdf_smart" /app/sandbox/code-api-server.js'
docker exec sansuo-code-api sh -lc 'grep -n "short_pdf_full_preview" /app/sandbox/sansuo_tools.py'
```

Inside LibreChat API container:

```bash
docker exec LibreChat sh -lc 'grep -n "read_pdf_find" /app/librechat.yaml /app/api/app/clients/tools/util/handleTools.js 2>/dev/null'
docker exec LibreChat sh -lc 'grep -n "SANDBOX_AVAILABLE_FILES" /app/librechat.yaml /app/api/app/clients/tools/util/handleTools.js 2>/dev/null'
```

## UI Safeguards

- Assistant text that looks like fake tool output (`Tool:`, `execute_code`, `stdout:`, `stderr:`, `generatedFiles`) is blocked in the message renderer and replaced with a short warning. Real tool calls still render through LibreChat's tool-call channel.
- Final SSE handling now re-adds/updates the completed conversation in the sidebar cache even if the user switched away while the answer or tool call was still running.
