from __future__ import annotations

import importlib


MODULES = (
    "bs4",
    "docx",
    "httpx",
    "jinja2",
    "lxml",
    "matplotlib",
    "numpy",
    "openpyxl",
    "pandas",
    "pdfplumber",
    "PIL",
    "pptx",
    "pypdf",
    "reportlab",
    "requests",
    "xlsxwriter",
    "yaml",
)


for module_name in MODULES:
    importlib.import_module(module_name)

print("LinkSense shared Python runtime imports succeeded.")
