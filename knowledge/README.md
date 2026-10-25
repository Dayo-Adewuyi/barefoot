# Knowledge bundle

The teammate answers recognition, examination, first-aid and prevention questions
from these documents. Doses come only from the Standing Orders, never from
*Where There Is No Doctor*.

## Sources, in order of precedence

1. **`national-guidelines/`**: the 2024 National Standing Orders (CHPRBN), CHEW
   and JCHEW volumes, **every section** (newborn, under 5, 6–12 years, adolescents,
   adults, pregnancy and family planning, elderly): 131 CHEW and 124 JCHEW files,
   each tagged with its age group. Rebuilt by `scripts/split_standing_orders.py`
   from the text-edition PDFs (download them into `sources/standing-orders/`, which
   git ignores). They override everything below. Upload all of them; each one
   applies only to its cadre.
2. **`where-there-is-no-doctor/`** — the Hesperian handbook (revised 1992, 2010
   printing), split one file per chapter by `scripts/split_book.py`.

## Which files to upload

`where-there-is-no-doctor/manifest.json` tags every chapter:

| Set | Meaning | Upload? |
| --- | --- | --- |
| `demo` | Examination, signs of dangerous illness, serious illnesses incl. malaria | Yes, for the TSG demo (3 files, about 11,000 words) |
| `core` | The rest of the clinical chapters | Yes, for real use |
| `optional` | Home remedies, vocabulary, medicine kit | Only if needed |
| `excluded` | The Green Pages (drug choices and doses) | **Never.** Kept in `excluded/` for reference only |

For the demo, upload only the three `demo` files to save credits.

## Why the Green Pages are excluded

The book's medicine advice predates current practice. For example, its malaria
section centres on chloroquine dosing and does not cover artemisinin-based
combination therapy as first-line treatment, malaria rapid tests, or oral zinc for
diarrhoea. The book itself says the Green Pages should be adapted to each
country's guidelines.

