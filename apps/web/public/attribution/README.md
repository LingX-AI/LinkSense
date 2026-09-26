# Attribution Marks

These are the official marks required by Section 14 of CPAL-1.0. **Exhibit B points at
`linksense-mark.svg`, so these files must stay where they are** — with nothing at the
path, there is nothing to display and the attribution clause has no effect.

---

## The three variants

| File | Use |
|---|---|
| `linksense-mark.svg` | **default for attribution** — full colour, light backgrounds |
| `linksense-mark-dark.svg` | monochrome dark — light backgrounds, understated |
| `linksense-mark-light.svg` | monochrome light — dark backgrounds |

These are the **full horizontal lockup** — icon plus wordmark — because that is the
complete LinkSense identity, and because the Attribution Phrase is only "Powered by":
the name is carried by the wordmark inside the image.

`linksense-mark-light.svg` is pure white. It looks **blank** when previewed against a
white file browser background — that is expected, not a broken file.

Shipping three is deliberate. It removes any legitimate reason for a downstream user to
edit the mark to fit their theme — which is what lets us ask that it not be edited at
all.

---

## Why not the icon-only marks

The icon marks in [`docs/brand/`](../../../../docs/brand/) are app icons — favicon, PWA
install icon, browser tab. They are **not** attribution marks, for two reasons.

The Attribution Phrase is only "Powered by", so an icon-only mark would leave the name
nowhere in the notice. And pointing Exhibit B at the favicon would mean that
redesigning the favicon silently changes what the license requires. Keep them separate.

---

## Technical checks already performed

- ✅ No `<text>` elements — all glyphs are outlined, so no font dependency
- ✅ No external references (no remote fonts, images, or CSS) — nothing to fail to load
  inside a customer's air-gapped network
- ✅ No embedded rasters; pure vector paths
- ✅ `<mask>` ids are unique per file — inlining several of these into one HTML page
  will not cause them to collide (they were all `id="cut"` originally, which would
  have silently broken the masking)
- ✅ Legibility verified at 24 / 20 / 18 / 16px. The lockup is clean from 18px up and
  strains below it, so the component floors the mark at 18px and defaults to 20px

---

## If the marks are updated later

Keep the filenames, overwrite the files, then:

1. Re-run the legibility check (render at 16px and 24px and look at them)
2. Confirm the new files contain no `<text>`, no external references, and unique mask
   ids
3. Run `node --test scripts/license.test.mjs` from the repository root
4. **Send the same artwork to trademark counsel to update the registration** — the mark
   used for attribution and the mark on file should be the same one, or enforcement
   later invites an argument about whether they are.
