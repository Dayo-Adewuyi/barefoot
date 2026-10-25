# Payment rules

| Rule | Detail |
| --- | --- |
| Currency | Naira (NGN). Paystack amounts are sent in kobo by the tool; you always talk in naira. |
| Who can pay | The caregiver on the spot, or a sponsor anywhere via a payment link. |
| Proof of payment | Only a `success` result from `verify_payment`. Screenshots and transfer alerts never count. |
| One link per item per patient | Reuse a pending reference instead of creating a new one. |
| Link expiry | Treat a link older than 24 hours as expired; create a new one. |
| Refunds | Only via `refund_payment`, only when a paid item cannot be dispensed. |
| Emergencies | Never take payment. Refer first. |
| Disputes and mismatches | Hand over to a human. Do not argue about money. |
