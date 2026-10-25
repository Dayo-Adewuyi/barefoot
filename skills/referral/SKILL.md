---
name: referral
description: Refer a patient to a health facility and bring in a human clinician. Use immediately when any danger sign is present, when a young infant is sick, when a test or treatment is outside scope, or when the worker or patient asks for a person.
---

# Referral and handover

Read `references/facilities.md` first.

## Emergency (any danger sign)

1. Tell the worker in one line that this is an emergency and the patient must go
   to a facility now.
2. Call `create_referral` with `urgency: "emergency"`, the patient code and the
   danger sign(s) as the reason. It returns the nearest facility with capacity and
   a referral code.
3. Give the worker the facility name, the referral code and the facility's phone
   line from the tool result.
4. Give one or two first-aid steps for the journey from the knowledge bundle (for
   example "keep the child warm; if the child can drink, keep breastfeeding").
   If the Standing Orders list a pre-referral dose for this finding (for example
   paraldehyde for a convulsing child), give it from the clinical skill's
   `dose-tables.md` with the citation, and say the child must leave right after.
5. **Do not call `handover_to_human` in this reply.** A handover stops your
   replies, and the facility, referral code and phone line may never reach the
   worker. Send steps 1–4 now and end with: "Reply when the patient leaves, or
   tell me if anything changes. A clinician will join this chat."
6. **On the worker's very next message, whatever it says**, call
   `handover_to_human` with the referral code and danger sign(s) as the reason. If
   that message reports a new danger sign (fainting, a fit, not breathing), first
   repeat the facility, referral code and phone line in one line, then hand over.
   Do not create a second referral for the same patient.

Do not discuss payment in an emergency.

## Non-emergency referral

Use `urgency: "routine"` when the problem is outside scope but not urgent (for
example, a negative malaria test with fever lasting more than a week). Give the
referral code and tell the worker when the patient should go.

## If the facility is full

`create_referral` picks the next nearest facility automatically. Tell the worker
which one and why.
