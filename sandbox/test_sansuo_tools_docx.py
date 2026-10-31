import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
HELPER_PATH = ROOT / "sandbox" / "sansuo_tools.py"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def load_helper():
    spec = importlib.util.spec_from_file_location("sansuo_tools_under_test", HELPER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_xml(docx_path, member):
    with zipfile.ZipFile(docx_path) as archive:
        return ET.fromstring(archive.read(member))


def find_paragraph(root, style_id):
    for paragraph in root.iter(f"{W}p"):
        style = paragraph.find(f"{W}pPr/{W}pStyle")
        if style is not None and style.get(f"{W}val") == style_id:
            return paragraph
    return None


def find_style(root, style_id):
    for style in root.findall(f"{W}style"):
        if style.get(f"{W}styleId") == style_id:
            return style
    return None


def find_paragraph_containing(root, text):
    for paragraph in root.iter(f"{W}p"):
        paragraph_text = "".join(node.text or "" for node in paragraph.iter(f"{W}t"))
        if text in paragraph_text:
            return paragraph
    return None


class CreateDocxFormattingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.helper = load_helper()

    def create(self, **formatting):
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        output = Path(tempdir.name) / "result.docx"
        self.helper.create_docx(
            "# 一、项目背景\n正文 Body 123\n## 二级标题\n后续内容",
            output=str(output),
            title="三所小智测试 Report 2026",
            **formatting,
        )
        self.assertTrue(output.is_file())
        self.assertGreater(output.stat().st_size, 0)
        return output

    def test_default_title_and_heading_contract(self):
        output = self.create()
        document = read_xml(output, "word/document.xml")
        styles = read_xml(output, "word/styles.xml")

        title = find_paragraph(document, "Title")
        heading_one = find_paragraph(document, "Heading1")
        heading_two = find_paragraph(document, "Heading2")
        self.assertIsNotNone(title)
        self.assertIsNotNone(heading_one)
        self.assertIsNotNone(heading_two)
        self.assertEqual(title.find(f"{W}pPr/{W}jc").get(f"{W}val"), "center")
        self.assertIsNone(heading_one.find(f"{W}pPr/{W}jc"))

        for paragraph in (title, heading_one, heading_two):
            self.assertIsNone(paragraph.find(f"{W}pPr/{W}pBdr"))
            color = paragraph.find(f"{W}r/{W}rPr/{W}color")
            underline = paragraph.find(f"{W}r/{W}rPr/{W}u")
            fonts = paragraph.find(f"{W}r/{W}rPr/{W}rFonts")
            self.assertEqual(color.get(f"{W}val"), "000000")
            self.assertIsNone(color.get(f"{W}themeColor"))
            self.assertEqual(underline.get(f"{W}val"), "none")
            self.assertEqual(fonts.get(f"{W}ascii"), "Times New Roman")
            self.assertEqual(fonts.get(f"{W}eastAsia"), "宋体")

        for style_id in ("Title", "Heading1", "Heading2", "Heading3"):
            style = find_style(styles, style_id)
            self.assertIsNotNone(style)
            self.assertIsNone(style.find(f"{W}pPr/{W}pBdr"))
            color = style.find(f"{W}rPr/{W}color")
            self.assertEqual(color.get(f"{W}val"), "000000")
            self.assertIsNone(color.get(f"{W}themeColor"))

    def test_explicit_user_formatting_overrides_defaults(self):
        output = self.create(
            title_font_color="#FF0000",
            title_underline=True,
            heading_font_color="蓝色",
            heading_alignment="right",
            heading_font_name="Arial",
            font_name="Calibri",
        )
        document = read_xml(output, "word/document.xml")
        title = find_paragraph(document, "Title")
        heading = find_paragraph(document, "Heading1")
        body = find_paragraph_containing(document, "Body 123")

        title_color = title.find(f"{W}r/{W}rPr/{W}color")
        title_underline = title.find(f"{W}r/{W}rPr/{W}u")
        heading_color = heading.find(f"{W}r/{W}rPr/{W}color")
        heading_fonts = heading.find(f"{W}r/{W}rPr/{W}rFonts")
        body_fonts = body.find(f"{W}r/{W}rPr/{W}rFonts")
        self.assertEqual(title_color.get(f"{W}val"), "FF0000")
        self.assertEqual(title_underline.get(f"{W}val"), "single")
        self.assertEqual(heading_color.get(f"{W}val"), "0000FF")
        self.assertEqual(heading.find(f"{W}pPr/{W}jc").get(f"{W}val"), "right")
        self.assertEqual(heading_fonts.get(f"{W}ascii"), "Arial")
        self.assertEqual(heading_fonts.get(f"{W}eastAsia"), "Arial")
        self.assertEqual(body_fonts.get(f"{W}ascii"), "Calibri")
        self.assertEqual(body_fonts.get(f"{W}eastAsia"), "Calibri")

    def test_explicit_title_is_not_duplicated(self):
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        output = Path(tempdir.name) / "dedupe.docx"
        self.helper.create_docx(
            {"报告标题": {"一、背景": "正文"}},
            output=str(output),
            title="报告标题",
        )
        document = read_xml(output, "word/document.xml")
        texts = [node.text for node in document.iter(f"{W}t") if node.text]
        self.assertEqual(texts.count("报告标题"), 1)


if __name__ == "__main__":
    unittest.main()
