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

## Truck visualizer

The bottom section renders both sizes onto a side-profile photograph of the truck. It is a
measurement, not an illustration:

- Geometry was measured off the photo (603x199 after keying the studio background out):
  front axle `(87,159)`, rear axle `(475,158)`, rim disc radius `25.5px`, tire radius `38px`,
  ground line `y=197`, with a circle fitted to each fender arch.
- The **On it now** size sets pixels-per-inch: `76px / referenceDiameter`. Change it if the
  truck is wearing something other than 275/60R17 and everything rescales.
- Each wheel is redrawn by radially remapping the photographed wheel's own pixels: the rim
  disc scales with wheel diameter, the sidewall band stretches or compresses to reach the new
  outer radius. The result keeps the real tread, rim and lighting.
- The body stays fixed and the ground line moves, which is what actually happens: the axle
  sits at one tire radius above the ground, so ride height moves by half the diameter change
  and the fender gap closes by the same amount.
- Both panels share one ground line and one scale, so the two frames are directly comparable.

Section width is not shown — in side profile only diameter and sidewall are visible.

Base photograph is © EVOX Images and is credited in the page.

## The math

For a size `W/A R D`:

- sidewall (mm) = `W × A / 100`
- overall diameter (in) = `D + 2 × sidewall / 25.4`
- circumference (in) = `π × diameter`
- revolutions per mile = `63360 / circumference`
- speedometer ratio = `diameter₂ / diameter₁`
- ride height change = `(diameter₂ − diameter₁) / 2`

Percentages are computed from the rounded figures shown in the table, so the numbers on
screen always reconcile with the percentage beside them. This matches how tiresize.com
reports its comparisons.

## Scope

These are nominal dimensions derived from the size code. Real molded dimensions vary by
brand and tread pattern, and this does not check fender or suspension clearance.

Unrelated to the receptionist dashboard app in the rest of this repository — it lives
here only as a self-contained folder.
