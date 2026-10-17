#!/usr/bin/env python3
"""Independent checks for synthetic corpus exported by tests/corpus.test.ts.

Usage: python3 tests/compatibility/check.py [/tmp/norma-hardening/corpus]
Add --libreoffice to open, resave and export each package to PDF in LibreOffice.
No pip installation is required. python-docx and pdfinfo are used when installed.
This is a structural/LibreOffice check, never a Microsoft Word certification.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import subprocess
import tempfile
from urllib.parse import unquote
import xml.etree.ElementTree as ET
from zipfile import ZipFile

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P = "http://schemas.openxmlformats.org/package/2006/relationships"


def package(path: Path) -> tuple[dict[str, bytes], dict[str, object]]:
    with ZipFile(path) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)), f"duplicate ZIP entry: {path}"
        assert archive.testzip() is None, f"ZIP CRC failure: {path}"
        entries = {name: archive.read(name) for name in names}
    docs = {name: ET.fromstring(data) for name, data in entries.items()
            if name.lower().endswith((".xml", ".rels"))}
    for name, doc in docs.items():
        if name.endswith(".rels"):
            source = "" if name == "_rels/.rels" else re.sub(r"(^|/)_rels/", r"\1", name)[:-5]
            ids: set[str] = set()
            assert doc.tag == f"{{{P}}}Relationships", f"relationship root: {name}"
            for rel in doc:
                assert rel.tag == f"{{{P}}}Relationship", f"relationship element: {name}"
                rid = rel.attrib["Id"]
                assert rid not in ids, f"duplicate relationship: {name}#{rid}"
                ids.add(rid)
                if rel.get("TargetMode") == "External":
                    continue
                target = unquote(rel.attrib["Target"])
                resolved = target[1:] if target.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(source), target))
                assert resolved in entries, f"dangling relationship: {name} -> {target}"
            continue
        rel_path = posixpath.join(posixpath.dirname(name), "_rels", posixpath.basename(name) + ".rels")
        ids = {rel.attrib["Id"] for rel in docs[rel_path]} if rel_path in docs else set()
        for el in doc.iter():
            for key, value in el.attrib.items():
                if key in {f"{{{R}}}id", f"{{{R}}}embed", f"{{{R}}}link"}:
                    assert value in ids, f"dangling XML reference: {name} {key}={value}"
    root = docs["word/document.xml"]
    # Unlike the application parser, ElementTree checks every XML part, and
    # Python zipfile independently verifies central directory and file CRCs.
    result: dict[str, object] = {
        "file": path.name,
        "bytes": path.stat().st_size,
        "zip_parts": len(entries),
        "xml_parts": len(docs),
        "paragraphs": len(list(root.iter(f"{{{W}}}p"))),
        "tables": len(list(root.iter(f"{{{W}}}tbl"))),
        "sections": len(list(root.iter(f"{{{W}}}sectPr"))),
        "media_sha256": {name: sha256(data).hexdigest() for name, data in entries.items()
                         if "/media/" in name or "/embeddings/" in name},
    }
    try:
        from docx import Document
    except ImportError:
        result["python_docx"] = "not installed; ElementTree/zipfile checks completed"
    else:
        parsed = Document(path)
        result["python_docx"] = {"sections": len(parsed.sections), "tables": len(parsed.tables), "inline_shapes": len(parsed.inline_shapes),
                                 "section_sizes_twips": [[section.page_width.twips, section.page_height.twips] for section in parsed.sections]}
    return entries, result


def libreoffice(path: Path, out: Path) -> dict[str, object]:
    binary = shutil.which("soffice") or shutil.which("libreoffice")
    assert binary, "LibreOffice requested but soffice/libreoffice is not installed"
    result: dict[str, object] = {"version": subprocess.run([binary, "--version"], text=True, capture_output=True, timeout=15, check=True).stdout.strip()}
    with tempfile.TemporaryDirectory(prefix="norma-lo-") as profile:
        environment = os.environ.copy()
        cache = Path(profile) / "cache"
        cache.mkdir()
        environment["XDG_CACHE_HOME"] = str(cache)
        for ext, filter_name, folder in [("pdf", "pdf", "pdf"), ("docx", "docx:Office Open XML Text", "roundtrip")]:
            target_dir = out / folder
            target_dir.mkdir(parents=True, exist_ok=True)
            command = [binary, f"-env:UserInstallation={Path(profile).as_uri()}", "--headless", "--convert-to", filter_name, "--outdir", str(target_dir), str(path)]
            completed = subprocess.run(command, text=True, capture_output=True, timeout=90, env=environment)
            target = target_dir / f"{path.stem}.{ext}"
            assert completed.returncode == 0 and target.exists() and target.stat().st_size > 0, f"LibreOffice {ext} failed: {completed.stdout} {completed.stderr}"
            assert not re.search(r"Error:|failed to load|source file could not", completed.stdout + completed.stderr, re.I), f"LibreOffice reported an error: {completed.stdout} {completed.stderr}"
            if ext == "docx":
                # Reopen the independently rewritten document using both Python
                # tools; rendering is a separate claim from OOXML preservation.
                _, rewritten = package(target)
                result["resaved_docx"] = {"bytes": target.stat().st_size, "xml_parts": rewritten["xml_parts"]}
            else:
                result["pdf_bytes"] = target.stat().st_size
                if shutil.which("pdfinfo"):
                    info = subprocess.run(["pdfinfo", str(target)], text=True, capture_output=True, timeout=15, check=True)
                    pages = re.search(r"^Pages:\s+(\d+)", info.stdout, re.M)
                    assert pages and int(pages[1]) > 0, "Empty LibreOffice PDF"
                    result["pdf_pages"] = int(pages[1])
                    info = subprocess.run(["pdfinfo", "-f", "1", "-l", pages[1], str(target)], text=True, capture_output=True, timeout=15, check=True)
                    sizes = re.findall(r"^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)", info.stdout, re.M)
                    orientations = ["landscape" if float(width) > float(height) else "portrait" for width, height in sizes]
                    assert "landscape" in orientations and orientations[0] == orientations[-1] == "portrait", "Mixed section orientation lost in LibreOffice PDF"
                    result["pdf_orientations"] = orientations
                if shutil.which("pdftotext"):
                    rendered = " ".join(subprocess.run(["pdftotext", str(target), "-"], text=True, capture_output=True, timeout=15, check=True).stdout.split())
                    assert "Основной текст" in rendered and "альбомного раздела" in rendered, "Expected corpus text missing from LibreOffice PDF"
                    result["pdf_text_verified"] = True
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=Path("/tmp/norma-hardening/corpus"))
    parser.add_argument("--libreoffice", action="store_true")
    args = parser.parse_args()
    directory = args.directory.resolve()
    originals = sorted(directory.glob("*-original.docx"))
    assert originals, f"No original fixtures in {directory}; run npx vitest run tests/corpus.test.ts first"
    results = []
    for original in originals:
        fixed = original.with_name(original.name.replace("-original.docx", "-fixed.docx"))
        before, original_result = package(original)
        after, fixed_result = package(fixed)
        assert before.keys() == after.keys(), "ZIP part set changed"
        for name, data in before.items():
            if name != "word/document.xml":
                assert data == after[name], f"Unintended change in ZIP part {name}"
        before_xml = ET.fromstring(before["word/document.xml"])
        after_xml = ET.fromstring(after["word/document.xml"])
        assert list(before_xml.itertext()) == list(after_xml.itertext()), "Text changed during transformation"
        for item, file in [(original_result, original), (fixed_result, fixed)]:
            if args.libreoffice:
                item["libreoffice"] = libreoffice(file, directory / "libreoffice")
            results.append(item)
    report = {"structural_validity": "passed", "untouched_parts_and_text": "passed", "libreoffice": "passed" if args.libreoffice else "not requested", "microsoft_word": "not tested", "documents": results}
    output = json.dumps(report, ensure_ascii=False, indent=2)
    (directory / "compatibility-report.json").write_text(output + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
