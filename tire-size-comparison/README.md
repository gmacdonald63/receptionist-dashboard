# Tire Size Comparison

A standalone, single-file tire size calculator. Enter two sizes (e.g. `265/65R18` vs
`225/55R18`) and it compares diameter, tread width, sidewall height, circumference and
revolutions per mile, draws both tires to scale, works out the resulting speedometer
error, and lists alternate sizes that fall within the ±3% fitment window.

## Running it

No build step, no dependencies to install. Open `index.html` in a browser:

```bash
open tire-size-comparison/index.html        # macOS
xdg-open tire-size-comparison/index.html    # Linux
```

To deploy, upload `index.html` anywhere that serves static files (Vercel, Netlify,
GitHub Pages, an S3 bucket). It is one file — nothing else needs to go with it.

## The math

For a size `W/A R D`:

- sidewall (mm) = `W × A / 100`
- overall diameter (in) = `D + 2 × sidewall / 25.4`
- circumference (in) = `π × diameter`
- revolutions per mile = `63360 / circumference`
- speedometer ratio = `diameter₂ / diameter₁`

Percentages are computed from the rounded figures shown in the table, so the numbers on
screen always reconcile with the percentage beside them. This matches how tiresize.com
reports its comparisons.

## Scope

These are nominal dimensions derived from the size code. Real molded dimensions vary by
brand and tread pattern, and this does not check fender or suspension clearance.

Unrelated to the receptionist dashboard app in the rest of this repository — it lives
here only as a self-contained folder.
