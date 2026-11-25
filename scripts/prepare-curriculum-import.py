"""Prepare a private, review-only import using Zion's source PDF and ZIP."""

import argparse
import json
import re
import subprocess
import tempfile
import zipfile
from collections import Counter
from pathlib import Path

from pypdf import PdfReader


PDF_STATUS = {
    "Search lead": "search",
    "Candidate link": "candidate",
    "Partial link": "partial",
    "Documented supplement": "supplement",
    "Separate checkpoint": "checkpoint",
    "Evidence needed": "needed",
}
ELA_EDITIONS = ("4.6", "3.6", "4.5", "4.4", "3.1", "4.1")
ARKANSAS_SOURCES = {
    "ELA": "https://dese.ade.arkansas.gov/Files/AR_2023_K-12_ELA_Standards_LS_7.2023_LS.pdf",
    "Math": "https://dese.ade.arkansas.gov/Files/AR_2023_K-8%2C_Alg%2C_Geo_Math_Standards_LS_6.21.23_LS.pdf",
}
STANDARD_ROW = re.compile(
    r"^([0-6K]\.[A-Z]+\.\d+[A-Za-z]?(?:\.[A-Z]+)?)\n(" + "|".join(PDF_STATUS) + r")\n", re.M
)
ELA_LESSON = re.compile(r"^Lesson (\d+) · (.*?)\s*\(p\.\s*([^)]*)\)", re.M | re.S)
MATH_SECTION = re.compile(
    r"^Chapter (\d+), ([^\n]+?) \(([1-5][A-D]) pg\.\s*([^;\n)]+)(?:;\s*Online:\s*([^)]*))?\)", re.M
)


def extract_reference(pdf, root):
    """Read standards and review clues. The CSV owns checklist identity and order."""
    math_catalog = (root / "supabase_k8_math_standards.sql").read_text()
    math_pages = {
        code: page
        for page, codes in re.findall(r", (\d+), '([K1-8][^']*)'\)", math_catalog)
        for code in codes.split()
    }
    catalogs = [
        {"key": f"tgtb-{grade}-{edition}", "subject": "ELA", "level": "K" if grade == 0 else str(grade)}
        for grade, edition in enumerate(ELA_EDITIONS)
    ] + [
        {"key": f"beast-{level}-crosswalk", "subject": "Math", "level": str(level)}
        for level in range(1, 6)
    ]
    standards = []
    reviews = []
    items = {}
    counts = Counter()

    for page_number, page in enumerate(PdfReader(pdf).pages, 1):
        if page_number == 1:
            continue
        # The supplied map has separate grade bands for ELA and math.
        subject = "ELA" if page_number <= 34 else "Math"
        source = f"Zion Arkansas Curriculum Standards Map, PDF page {page_number}"
        content = page.extract_text()
        matches = list(STANDARD_ROW.finditer(content))
        for position, match in enumerate(matches):
            code, status = match.groups()
            grade = 0 if code[0] == "K" else int(code[0])
            catalog_key = (
                catalogs[grade]["key"] if subject == "ELA" else f"beast-{min(5, max(grade, 1))}-crosswalk"
            )
            standard_key = f"{subject.lower()}:2023:{code}"
            standard_source = ARKANSAS_SOURCES[subject]
            if subject == "Math":
                standard_source += f"#page={math_pages[code]}"
            standards.append({
                "key": standard_key, "subject": subject, "grade": grade, "code": code,
                "edition": "2023", "source": standard_source, "family_description": None,
            })

            end = matches[position + 1].start() if position + 1 < len(matches) else len(content)
            block = content[match.end():end].strip()
            references = list((ELA_LESSON if subject == "ELA" else MATH_SECTION).finditer(block))
            item_keys = []
            for reference in references:
                if subject == "ELA":
                    number, title, _ = reference.groups()
                    order = int(number)
                    key = f"lesson-{order:03d}"
                    unit = ""
                else:
                    chapter, title, volume, pages, _ = reference.groups()
                    first_page = int(re.search(r"\d+", pages).group())
                    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
                    key = f"{volume.lower()}-{first_page}-{slug}"
                    unit = f"Chapter {chapter}"
                    order = int(chapter) * 1000 + first_page
                items.setdefault((catalog_key, key), {
                    "key": key, "catalog_key": catalog_key, "unit": unit,
                    "sort_order": order, "title": " ".join(title.split()),
                })
                item_keys.append(key)
            evidence = block[references[-1].end():] if references else block
            disposition = PDF_STATUS[status]
            for item_key in dict.fromkeys(item_keys or [None]):
                reviews.append({
                    "key": f"zion-pdf-v1:{standard_key}:{item_key or 'review'}", "standard_key": standard_key,
                    "catalog_key": catalog_key, "item_key": item_key, "disposition": disposition,
                    "covered": " ".join(block.split()) if references else None,
                    "evidence_needed": " ".join(evidence.split()), "source": source,
                })
            counts[disposition] += 1

    expected = Counter(candidate=40, partial=41, supplement=3, checkpoint=23, search=300, needed=200)
    if len({standard["key"] for standard in standards}) != 607 or counts != expected:
        raise ValueError("The PDF does not match the supplied Zion crosswalk. Review its layout and edition.")
    return {"catalogs": catalogs, "items": list(items.values()), "standards": standards, "reviews": reviews}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("zip_file", type=Path)
    parser.add_argument("output", type=Path, help="Write outside the website repository")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    output = args.output.resolve()
    if output.is_relative_to(root):
        parser.error("Choose an output path outside the public website repository.")
    reference = extract_reference(args.pdf, root)
    with tempfile.TemporaryDirectory(prefix="zion-curriculum-") as temp:
        folder = Path(temp)
        pdf_data = folder / "pdf-reference.json"
        pdf_data.write_text(json.dumps(reference, ensure_ascii=False), encoding="utf-8")
        with zipfile.ZipFile(args.zip_file) as package:
            for name in package.namelist():
                if name.endswith(".csv"):
                    (folder / Path(name).name).write_bytes(package.read(name))
        subprocess.run(
            ["node", str(root / "scripts/merge-curriculum-references.cjs"), str(pdf_data), str(folder), str(output)],
            check=True,
        )


if __name__ == "__main__":
    main()
