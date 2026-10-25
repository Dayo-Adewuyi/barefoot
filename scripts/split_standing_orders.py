#!/usr/bin/env python3
"""Extract every section of the 2024 National Standing Orders (CHPRBN) into one
Markdown file per section for a Chord knowledge bundle.

Usage:
    python3 scripts/split_standing_orders.py path/to/CHEW-Section-1-7-TEXT.pdf \
        path/to/JCHEW-Section-1-7-TEXT-1.pdf

Writes knowledge/national-guidelines/*.md plus manifest.json.

Requires poppler-utils (pdftotext). Text is kept in layout mode so the
history / examination / finding / action columns stay side by side. Doses the
agent may quote live in skills/clinical-protocols/references/dose-tables.md,
not here; this text is the citation source.

Section titles come from each volume's table of contents. Start pages come from
the heading ("5.2 FEVER") found in the body text, because the JCHEW contents
page prints wrong page numbers for several sections. PDF page = printed page.
"""
import json
import pathlib
import re
import subprocess
import sys

TITLES = {
    "CHEW": "National Standing Orders for Community Health Extension Workers",
    "JCHEW": "National Standing Orders for Junior Community Health Extension Workers",
}
URLS = {
    "CHEW": "https://chprbn.gov.ng/wp-content/uploads/2024/12/CHEW-Section-1-7-TEXT.pdf",
    "JCHEW": "https://chprbn.gov.ng/wp-content/uploads/2024/12/JCHEW-Section-1-7-TEXT-1.pdf",
}
# Who each top-level section is for, as printed on its cover page.
GROUPS = {
    "1": "newborn",
    "2": "early childhood, under 5 years",
    "3": "middle childhood, 6-12 years",
    "4": "adolescent, 10-19 years",
    "5": "adult, 18-59 years",
    "6": "women: pregnancy, birth, family planning",
    "7": "elderly, 60 years and over",
}
TOC_PAGES = 17
TOC_LINE = re.compile(r"^\s*(\d\.\d{1,2}(?:\.\d)?)\.?\s*:?\s*([A-Z][^\t]*?[A-Z)])\s*(?:\t|\s{2,}|$)")

HEADER = """---
source: "{source} (CHPRBN, 2024 revision)"
cadre: "{cadre}"
section: "{section}"
title: "{title}"
age_group: "{group}"
pages: "{first}-{last}"
official_url: "{url}"
precedence: "Highest. Overrides Where There Is No Doctor. Applies only to {cadre} workers."
---

# {cadre} Standing Orders {section}: {title} ({group})

> Source: *{source}*, 2024 revision, section {section}, pages {first}-{last}.
> Applies to **{cadre}** workers only, for patients in the **{group}** group.

"""


def pdftotext(pdf: str, first: int, last: int) -> str:
    return subprocess.run(
        ["pdftotext", "-layout", "-f", str(first), "-l", str(last), pdf, "-"],
        capture_output=True, text=True, check=True,
    ).stdout


def page_text(pdf: str, page: int) -> str:
    # Drop the running head ("NATIONAL STANDING ORDERS FOR ... PAGE n"). Collapse
    # long runs of layout spaces: some pages come out over 90% spaces, which Chord
    # rejects as a corrupt file. Four spaces still separate the columns.
    lines = [re.sub(r" {4,}", "    ", ln.rstrip()) for ln in pdftotext(pdf, page, page).splitlines()
             if "NATIONAL STANDING ORDERS FOR" not in ln]
    return "\n".join(lines).strip()


def slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60]


def table_of_contents(pdf: str) -> list[tuple[str, str]]:
    seen, toc = set(), []
    for line in pdftotext(pdf, 1, TOC_PAGES).splitlines():
        m = TOC_LINE.match(line.replace("’", "'"))
        if m and m.group(1) not in seen:
            seen.add(m.group(1))
            toc.append((m.group(1), " ".join(m.group(2).split()).title()))
    return toc


def sections(pdf: str, pages: int) -> list[tuple[str, str, int, int]]:
    """(number, title, first page, last page) for every section found in the body."""
    texts = {p: page_text(pdf, p) for p in range(TOC_PAGES + 1, pages + 1)}
    found, after = [], TOC_PAGES + 1
    for number, title in table_of_contents(pdf):
        head = re.compile(rf"^\s*{re.escape(number)}\.?\s*:?\s*[A-Z]", re.M)
        page = next((p for p in range(after, pages + 1) if head.search(texts[p])), None)
        if page is None:
            print(f"  heading {number} {title} not found in body; folded into previous section")
            continue
        found.append([number, title, page])
        after = page
    out = []
    for i, (number, title, first) in enumerate(found):
        nxt = found[i + 1][2] if i + 1 < len(found) else pages
        out.append((number, title, first, max(first, nxt)))
    return out


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    pdfs = {"CHEW": sys.argv[1], "JCHEW": sys.argv[2]}
    out_dir = pathlib.Path(__file__).resolve().parent.parent / "knowledge" / "national-guidelines"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.md"):
        old.unlink()
    manifest = []
    for cadre, pdf in pdfs.items():
        pages = int(re.search(r"Pages:\s+(\d+)", subprocess.run(
            ["pdfinfo", pdf], capture_output=True, text=True, check=True).stdout).group(1))
        print(f"{cadre}: {pages} pages")
        for section, title, first, last in sections(pdf, pages):
            group = GROUPS[section.split(".")[0]]
            body = "\n\n".join(
                f"<!-- page {p} -->\n```text\n{page_text(pdf, p)}\n```" for p in range(first, last + 1)
            )
            name = f"{cadre.lower()}-{section}-{slugify(title)}.md"
            (out_dir / name).write_text(
                HEADER.format(source=TITLES[cadre], cadre=cadre, section=section, title=title,
                              group=group, first=first, last=last, url=URLS[cadre])
                + body + "\n"
            )
            manifest.append({"file": name, "cadre": cadre, "section": section, "title": title,
                             "age_group": group, "pages": [first, last], "words": len(body.split())})
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {len(manifest)} sections to {out_dir}")


if __name__ == "__main__":
    main()
