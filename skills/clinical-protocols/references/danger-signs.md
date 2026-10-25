# Danger signs

> Newborn, child and pregnancy signs come from the 2024 National Standing Orders
> (CHPRBN), CHEW and JCHEW volumes; the section and page follow each list. Full
> text is in `knowledge/national-guidelines/`.

If the patient has **any one** of the signs below, treat the case as an emergency:
refer immediately, then hand over to a human clinician (referral skill: details first,
handover on the next message). Do not start payment.
Give only the pre-referral steps and doses that the Standing Orders list for that
finding (see `dose-tables.md`), and never let them delay the referral.

## Suspected Ebola or other haemorrhagic fever (any age): ask this first

There is an Ebola outbreak (Bundibugyo strain) in the DR Congo and Uganda. As of
NCDC's advisory of 28 May 2026 Nigeria had no confirmed case, but NCDC rates the
risk of importation as high. Early Ebola looks like malaria or Lassa fever.

For **every** patient with fever, ask:

- In the last 21 days, has the patient travelled to the DR Congo, Uganda or another
  country with Ebola, or been with someone who has?
- In the last 21 days, has the patient touched a sick or dead person who had
  fever or bleeding, or attended a burial?
- In the last 21 days, has the patient touched sick or dead animals or bushmeat?

**Suspect Ebola** (NCDC case definition, version 2, 31 May 2026) if any of these:

1. Sudden fever plus 3 or more of: headache, tiredness, loss of appetite, aching
   muscles or joints, belly pain, difficulty swallowing, vomiting, difficulty
   breathing, diarrhoea, hiccups; **and** that travel in the last 21 days.
2. Unexplained bleeding **and** that travel.
3. Sudden fever, with or without other signs, **and** contact with a confirmed or
   probable case in the last 21 days.
4. Sudden fever not responding to the usual fever treatment **and** contact with
   wildlife (sick or dead animals, bushmeat) in the last 21 days.

Also suspect a haemorrhagic fever (Ebola, Lassa) for fever with bleeding from the
nose, eyes, ears or gums, vomiting or coughing up blood, or bloody diarrhoea (SO
2.3 VI: CHEW p. 55, JCHEW p. 56; SO 5.2 VII: CHEW p. 244, JCHEW p. 241). **Do not
wait for bleeding** if the history fits.

**What to tell the worker, in this order:**

1. **Do not touch the patient** or their blood, vomit, stool or urine without
   gloves and protection. Do not prick a finger for an RDT or give an injection
   without that protection.
2. **Keep the patient apart** from other people, in a separate room or space.
   Only one carer, and that carer avoids body fluids.
3. **Call NCDC now: 6232** (toll-free). WhatsApp +234 708 711 0839, SMS
   +234 809 955 5577. Also tell the LGA disease surveillance officer.
4. **Refer** as an emergency: call `create_referral` with `urgency: "emergency"`
   and "suspected Ebola" in the reason, so the facility can prepare isolation.
   Do not send the patient on public transport.
5. If the patient can drink, give ORS while waiting (SO 2.3 VI, 5.2 VII: "no
   specific treatment ... oral rehydration salts or intravenous fluids").
6. A sudden unexplained death in the community is also reported to NCDC. The
   body is not washed or touched by family; NCDC arranges a safe burial.

**No medicine and no dose** for suspected Ebola. Do not discuss payment.
Then follow the referral skill (details first, handover on the next message).

(Sources: NCDC "Case Definitions for Ebola Viral Disease Version 2" and
"National Public Health Advisory on State Preparedness for Bundibugyo EVD",
ncdc.gov.ng, May 2026. Check ncdc.gov.ng for any newer notice.)

## Child, 2 months to 5 years, with fever

Ask:

- Is the child vomiting everything?
- Is the child unable to drink or breastfeed (suckle)?
- Has the child had a convulsion (fit) during this illness, or is the child convulsing now?
- Does the child have a stiff neck?

Look for:

- Change in alertness, lethargy (weak, no energy) or prostration
- Bulging fontanelle (soft spot on the head)
- Anaemia (very pale palms or inner eyelids)
- Moderate dehydration

(SO 2.3 finding I: CHEW p. 53, JCHEW p. 53.) Also refer immediately for fever
with bleeding from the nose, eyes, ears or gums (suspected haemorrhagic fever,
SO 2.3 VI: use universal precautions), and for fever with a measles rash plus
any severe sign (SO 2.3 V).

## Child with convulsions

- Convulsing now with temperature above 38.7 °C → pre-referral paraldehyde,
  child on their side, nothing in the mouth, refer urgently (SO 2.4 i).
- Convulsion more than 24 hours ago, temperature above 37.5 °C and a bulging
  fontanelle, stiff neck or signs of head injury → suspected meningitis or head
  injury, refer (SO 2.4 ii).

(CHEW pp. 57–58, JCHEW pp. 58–59.)

## Newborn and young infant, under 2 months

Any one of these → refer immediately to the next higher-level facility:

- Abnormal temperature: warm to touch or rectal temperature 38 °C or above
  (JCHEW volume: 38.5 °C), or cold to touch (below 36.5 °C)
- Poor sucking, unable to suckle, or not feeding at all
- Fast breathing (60 or more a minute), severe chest in-drawing, nasal flaring
  or grunting
- Convulsions or fits, no movement or movement only when stimulated, lethargy
  or unconsciousness
- Yellow hands and body
- Bleeding from the cord, or redness around the cord spreading to the skin
- Bulging fontanelle, pus draining from the ear, swollen belly
- Locked jaw, stiffness or spasms (suspected neonatal tetanus, SO 1.3.11: CHEW p. 38, JCHEW p. 40)
- Low birth weight (2.5 kg or below) and sucking poorly. CHEW volume: refer
  immediately if under 1.5 kg; from 1.5 kg to under 2.5 kg, feed expressed breast
  milk every 2–3 hours and keep warm with Kangaroo Mother Care (CHEW SO 1.4 i, p. 41).
  JCHEW volume: refer every such baby (JCHEW SO 1.4 vii, p. 45).

(SO 1.3 introduction and 1.3.13 Severely ill baby: CHEW pp. 28, 40; JCHEW pp. 27, 43.)
Keep the baby warm and keep breastfeeding on the way. Do not treat in the community
beyond the pre-referral steps listed for that finding.

Birth abnormalities (genitalia, lump on the back, very big head, cleft lip or
palate, clubfoot and others) are not emergencies: refer routinely to hospital
(SO 1.4: CHEW pp. 41–42, JCHEW pp. 44–45).

## Pregnant woman

- Bleeding from the vagina at any stage of pregnancy (SO 6.1 II–III)
- Convulsions or fits, or unconsciousness (SO 6.1 IV: suspected eclampsia)
- Severe headache, blurred vision, pain in the upper belly or vomiting after 20
  weeks (SO 6.1 V: suspected severe pre-eclampsia)
- Difficult breathing, yellow eyes, or very pale (SO 6.1 I: suspected severe anaemia)
- Severe pain in the belly

(CHEW SO 6.1 pp. 311–312, JCHEW SO 6.1 pp. 310–311. Health education list,
SO 6.1: severe headache, vaginal bleeding, severe abdominal pain, convulsion.)

## After delivery

- Severe headache, or fits at home or on the way, in the days after delivery
  (SO 6.3 I: suspected postpartum eclampsia)
- Heavy bleeding (SO 6.2 VIII and 6.3 II: postpartum haemorrhage)

(CHEW SO 6.2–6.3 pp. 316–325, JCHEW pp. 315–324.)

## Child, 6 to 12 years

Fever with any of these → suspected severe malaria, refer (SO 3.2 I: CHEW p. 139,
JCHEW p. 138): convulsions, prostration (too weak to sit or stand), drowsy or
hard to wake, difficult breathing, abnormal bleeding, persistent vomiting, dark
or very little urine, yellow eyes, very pale.

Also refer immediately for: fever with a stiff neck (suspected meningitis, SO 3.2
II); cough with chest in-drawing or 40 or more breaths a minute (SO 3.4 I–II);
severe dehydration (very sunken eyes, skin pinch goes back very slowly, SO 3.5 I);
vomiting blood or with a hard, tender belly (SO 3.6 I).

## Adult, 18 to 59 years, and elderly

Refer immediately for (SO 5.2–5.5: CHEW pp. 243–252, JCHEW pp. 240–249):

- Fever with a stiff neck or severe headache (suspected meningitis, SO 5.2 II)
- Fever with yellow eyes, very drowsy or hard to wake, or after a head injury (SO 5.2 I)
- Fever with bleeding (see Ebola above, SO 5.2 VII)
- Fever over 38 °C with difficult breathing or confusion (SO 5.2 VIII)
- Cough with swollen feet, shortness of breath, blood in sputum, severe chest
  pain or getting tired very easily (suspected heart condition, SO 5.3 I)
- Diarrhoea with vomiting and severe dehydration: sunken eyes, dry tongue, fast
  pulse, little urine (SO 5.5 III); or a lump in the belly (SO 5.5 II)

Also use "Signs of dangerous illness" in the knowledge bundle (WTND p. 42):
unconsciousness, severe blood loss, inability to drink, severe belly pain, chest
pain with difficult breathing, convulsions. A patient aged 60 or over with any of
these is referred too (SO 7 has no separate list).

## When unsure

If the worker cannot answer a danger-sign question (for example, they cannot see
the child), treat the sign as present.
