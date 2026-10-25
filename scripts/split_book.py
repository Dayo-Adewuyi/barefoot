#!/usr/bin/env python3
"""Split *Where There Is No Doctor* (Hesperian, 2010 printing) into one
Markdown file per chapter for a Chord knowledge bundle.

Usage:
    python3 scripts/split_book.py path/to/WhereThereIsNoDoctor.pdf

Writes knowledge/where-there-is-no-doctor/*.md plus manifest.json.

Requires poppler-utils (pdftotext). The Green Pages (medicine choices and
doses) are deliberately written to an `excluded/` folder: they date from
1992-2010 and must not drive treatment. Current Nigerian national guidelines
take precedence. See knowledge/README.md.
"""
import json
import pathlib
import re
import subprocess
import sys

# Printed book page N sits on PDF page N + 47 in the 2010 Hesperian PDF.
PDF_OFFSET = 47

# (slug, title, first book page, last book page, set)
# set: "demo" = load for the TSG demo, "core" = load for real use,
#      "optional" = useful background, "excluded" = never load as guidance.
CHAPTERS = [
    ("01-home-cures-and-beliefs", "Home Cures and Popular Beliefs", 1, 16, "optional"),
    ("02-sicknesses-often-confused", "Sicknesses That Are Often Confused", 17, 28, "core"),
    ("03-examining-a-sick-person", "How to Examine a Sick Person", 29, 38, "demo"),
    ("04-caring-for-a-sick-person", "How to Take Care of a Sick Person (incl. Signs of Dangerous Illness)", 39, 44, "demo"),
    ("05-healing-without-medicines", "Healing Without Medicines", 45, 48, "optional"),
    ("06-right-and-wrong-use-of-medicines", "Right and Wrong Use of Modern Medicines", 49, 54, "core"),
    ("07-antibiotics", "Antibiotics: What They Are and How to Use Them", 55, 58, "core"),
    ("08-measuring-and-giving-medicine", "How to Measure and Give Medicine", 59, 64, "core"),
    ("09-injections", "Instructions and Precautions for Injections", 65, 74, "core"),
    ("10-first-aid", "First Aid", 75, 106, "core"),
    ("11-nutrition", "Nutrition: What to Eat to Be Healthy", 107, 130, "core"),
    ("12-prevention", "Prevention: How to Avoid Many Sicknesses", 131, 150, "core"),
    ("13-very-common-sicknesses", "Some Very Common Sicknesses", 151, 178, "core"),
    ("14-serious-illnesses", "Serious Illnesses That Need Special Medical Attention (incl. Malaria)", 179, 192, "demo"),
    ("15-skin-problems", "Skin Problems", 193, 216, "core"),
    ("16-eyes", "The Eyes", 217, 228, "core"),
    ("17-teeth-gums-mouth", "The Teeth, Gums, and Mouth", 229, 232, "core"),
    ("18-urinary-system-and-genitals", "The Urinary System and the Genitals", 233, 244, "core"),
    ("19-mothers-and-midwives", "Information for Mothers and Midwives", 245, 282, "core"),
    ("20-family-planning", "Having the Number of Children You Want", 283, 294, "core"),
    ("21-children", "Health and Sicknesses of Children", 295, 322, "core"),
    ("22-older-people", "Health and Sicknesses of Older People", 323, 330, "core"),
    ("23-medicine-kit", "The Medicine Kit", 331, 338, "optional"),
    ("green-pages", "The Green Pages: Uses, Dosage, and Precautions for Medicines", 339, 398, "excluded"),
    ("24-additional-information", "Additional Information (HIV, Pesticides, Abortion Complications, etc.)", 399, 418, "core"),
    ("25-vocabulary", "Vocabulary: Explaining Difficult Words", 419, 428, "optional"),
]

HEADER = """---
source: "Where There Is No Doctor (Hesperian Foundation, revised 1992, 2010 printing)"
chapter: "{title}"
book_pages: "{first}-{last}"
set: "{set}"
precedence: "Current Nigerian national guidelines override this text. Never use it to choose a medicine or dose."
---

# {title}

> Source: *Where There Is No Doctor*, David Werner et al., Hesperian Foundation. Book pages {first}-{last}.

"""

RUNNING_HEAD = re.compile(r"^\s*(\d{1,3}\s+)?Where There Is No Doctor 2010(\s+\d{1,3})?\s*$")


def page_text(pdf: str, book_page: int) -> str:
    pdf_page = book_page + PDF_OFFSET
    out = subprocess.run(
        ["pdftotext", "-f", str(pdf_page), "-l", str(pdf_page), pdf, "-"],
        capture_output=True, text=True, check=True,
    ).stdout
    lines = [ln.rstrip() for ln in out.splitlines() if not RUNNING_HEAD.match(ln)]
    text = "\n".join(lines).strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pdf = sys.argv[1]
    root = pathlib.Path(__file__).resolve().parent.parent / "knowledge" / "where-there-is-no-doctor"
    (root / "excluded").mkdir(parents=True, exist_ok=True)

    manifest = []
    for slug, title, first, last, chapter_set in CHAPTERS:
        body = []
        for bp in range(first, last + 1):
            txt = page_text(pdf, bp)
            if txt:
                body.append(f"<!-- page {bp} -->\n{txt}")
        content = HEADER.format(title=title, first=first, last=last, set=chapter_set) + "\n\n".join(body) + "\n"
        target = root / "excluded" if chapter_set == "excluded" else root
        path = target / f"{slug}.md"
        path.write_text(content, encoding="utf-8")
        manifest.append({
            "file": str(path.relative_to(root)),
            "title": title,
            "book_pages": [first, last],
            "set": chapter_set,
            "words": len(content.split()),
        })
        print(f"{chapter_set:9} {path.name:45} {len(content.split()):>7} words")

    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
