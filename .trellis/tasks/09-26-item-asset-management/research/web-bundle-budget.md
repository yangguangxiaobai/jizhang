# Web Bundle Budget Finding

The first complete web build for this task passes TypeScript, lint, mobile, motion, and color audits, but the existing PWA size gate fails:

| Measure | Current build | Existing hard limit | Difference |
|---|---:|---:|---:|
| Total JavaScript, raw | 343,603 B / 335.55 KiB | 320 KiB | +15.55 KiB |
| Total CSS, raw | 93,439 B / 91.25 KiB | 80 KiB | +11.25 KiB |

The final build's complete JS+CSS set is 138,745 B JavaScript gzip plus 25,997 B CSS gzip (164,742 B / ~160.88 KiB combined). The item views are route-split, so these totals include route chunks not loaded on the initial dashboard.

The user approved updating the limits to 352 KiB JavaScript and 96 KiB CSS. The PWA check and frontend quality spec now document the new raw-asset budgets. The current implementation remains route-split; continue to monitor compressed output as additional features land.
