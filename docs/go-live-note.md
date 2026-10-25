# Barefoot: go-live note

For the programme lead at Barefoot Health Initiative.

**What it does.** A health worker messages Barefoot on WhatsApp about a sick
patient. It asks about danger signs and Ebola exposure first. In an emergency it
sends the nearest hospital that is accepting patients, then hands the chat to a
person. Otherwise it gives the dose from the national Standing Orders, with the
page, and sends a payment link to the family or a relative elsewhere. The medicine
is released only after Paystack confirms the payment.

**What it does not do.** It does not diagnose or replace a clinician. It never asks
for patients' names or phone numbers. It only offers what you have in stock.

**When things go wrong.** A failed or abandoned payment keeps the medicine on the
shelf and offers a new link. A wrong amount goes to a person. A paid item that runs
out is refunded. Emergencies never wait for payment.

**Before real patients use it:**

1. **Someone answers every emergency.** Name an on-call clinician and test the
   alert that reaches them. *Today no one is alerted when it hands a chat over.*
2. **A doctor signs off every dose**, row by row against the cited page. None is
   signed off yet; the newer rows for older patients tell the worker so in the chat.
3. **Your real data:** workers, stock, prices and referral facilities.
4. **Monitoring:** a named person alerted if the server stops responding.
5. **Live payments:** Paystack live keys after their business checks, and a WhatsApp
   Business number connected through Chord. Payment records in a real database.
6. **Permissions** from Hesperian and CHPRBN to use their text.
