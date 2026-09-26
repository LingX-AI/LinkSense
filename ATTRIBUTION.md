# Attribution Guide

LinkSense is licensed under **CPAL-1.0**. Section 14 of that license asks for a small
attribution notice to be shown in graphical user interfaces.

This document is the **authoritative description of what satisfies that requirement**.
Follow it and you are compliant — you do not need to contact us to confirm (see the
safe harbour in [`LICENSE-EXCEPTIONS.md`](./LICENSE-EXCEPTIONS.md), Section 3).

---

## TL;DR

- **If it has a graphical interface, keep the attribution notice** — including
  internal deployments. Section 14 triggers on launch, not on distribution.
- **One area, at the foot of the interface, that stays put** as the user moves between
  screens. Not every screen needs its own — one area does the whole job.
- **Dialogs, full-screen modes, exported files** — exempt. **No watermark is ever
  required on anything the product generates.**
- **CLI, headless, and API-only use** — no display obligation at all.
- **Want your own branding?** Go ahead — product name, logo, colours are yours to
  change. The one-line attribution notice stays. See [Your own branding](#your-own-branding).

> ### Don't confuse this with the source disclosure obligation
>
> CPAL has two independent obligations with different triggers:
>
> | | Triggered by | Internal deployment |
> |---|---|---|
> | **§15** — publish your changes | redistribution, or serving third parties | **no** |
> | **§14** — show the attribution | launch through a GUI | **yes** |
>
> An enterprise running LinkSense on its own network owes **no source disclosure**
> whatsoever, but does keep the one-line footer notice.

---

## 1. What must be shown

The license lets us ask for up to four items. **We ask for two**, and they sit on one
line:

```
Powered by  [LinkSense logo]
```


| Item | Content | Required |
|---|---|---|
| Phrase (≤10 words) | `Powered by` | **yes** |
| One graphic image | `apps/web/public/attribution/linksense-mark.svg` — the full LinkSense lockup | **yes** |
| Copyright notice | — | no |

**The mark is the full lockup — icon plus wordmark — because that is the complete
LinkSense identity.** The name is carried by the wordmark inside the logo, which is why
the phrase is only "Powered by": pairing the two would print the name twice.

**The image's alt text must read `LinkSense`.** This is not decorative. Because the name
lives inside the image, the alt text is what keeps the notice readable when the image
fails to load, and what a screen reader announces. Never leave it empty.

**We do not require a copyright notice in your interface.** It lives in the source file
headers and [`NOTICE`](./NOTICE), where it belongs.

**Mark size:** between 18px and 24px tall. Below 18px the wordmark starts to strain;
24px is the ceiling the license's sizing rule allows next to footer-sized text.

---

## 2. Where it goes

**One dedicated attribution area, at the foot of the interface, that stays put as the
user moves around.** That is the whole rule. CPAL §14(a) names "a dedicated attribution
area on user interface screens" as a recognised form, and this is ours.

```
┌──────────────────────────────────────────┐
│  your product name          your header  │
├──────────────────────────────────────────┤
│                                          │
│              your application            │
│                                          │
├──────────────────────────────────────────┤
│  Powered by [LinkSense]   ← this area    │
└──────────────────────────────────────────┘
```

Concretely:

| Situation | What is expected |
|---|---|
| Sign-in / registration screen | at the foot of the page |
| Ordinary screens after sign-in | one area at the foot of the main interface, kept as the user switches between features |
| SSO, or opening an internal link directly | visible on the main interface they land on — not only on a sign-in page they never see |
| A standalone shared view, or an embedded window | at the foot of *that* entry point, since the main interface is not visible |

### Where it is *not* required

You do not need to repeat it, and you do not need to fight your own layout for it:

| Situation | |
|---|---|
| Dialogs, menus, popovers, tooltips, toasts | not repeated — the screen underneath already carries it |
| Full-screen editing, document preview, presentation mode | may be hidden while that mode is active, provided it returns on exit |
| Documents, images and other exports the product generates | **no watermark of any kind is required** |
| Command-line, headless, API-only | no display obligation at all |
| A session already open | does not have to show it again |

What does *not* satisfy the requirement: removing it from the ordinary screens, or
tucking it into a panel the user has no reason to open.

---

## 3. Reference implementation

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                          [ sign in ]                             │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                  Powered by  [LinkSense logo]                    │
└──────────────────────────────────────────────────────────────────┘
                   ↑ phrase      ↑ mark 18-24px
```

In HTML that is:

```html
<div role="note" aria-label="Powered by LinkSense">
  <span>Powered by</span>
  <img src="/attribution/linksense-mark.svg" alt="LinkSense" height="20" />
</div>
```

A ready-made component ships with the Web application:

```tsx
import { PoweredByLinkSense } from '@/components/brand/powered-by-linksense'

// Mount it once in the app shell's footer area, and once on the sign-in
// screen. No configuration needed.
<PoweredByLinkSense />
```

Source in `apps/web/src/components/brand/powered-by-linksense.tsx`.

**What you may adjust:** font size, weight, colour, padding, and where the attribution
area sits within the foot of the interface — as long as the phrase and mark stay
**clearly legible and visible**. Matching it to your background colour, or shrinking it
past readability, does not satisfy the requirement.

**What is fixed:** that there *is* such an area, and that it stays as the user moves
between the ordinary screens (§2). Exhibit B's exceptions are what give you room in
dialogs, full-screen modes and exports — you do not need to carve out more.

**What you may not adjust:** the mark itself. The license calls for the graphic image
*provided by the Original Developer*; recolouring, distorting, cropping, or adding
elements to it means it is no longer that image — and separately raises a trademark
problem.

---

## 4. Official mark variants

Fitting a colour logo onto a dark interface is a real problem, so we ship three
official variants of the lockup. Pick one — **you do not need to, and may not, modify
them**.

| Variant | Path | Use |
|---|---|---|
| Full colour | `apps/web/public/attribution/linksense-mark.svg` | **default**, light backgrounds |
| Monochrome dark | `apps/web/public/attribution/linksense-mark-dark.svg` | light backgrounds, understated |
| Monochrome light | `apps/web/public/attribution/linksense-mark-light.svg` | dark backgrounds |

Exhibit B names the first one, because Section 14(b) lets us require only one image.
The other two are alternatives we additionally permit — see
[`LICENSE-EXCEPTIONS.md`](./LICENSE-EXCEPTIONS.md) §3. We ship them precisely so that
fitting the mark to your theme never requires editing it. Need one we do not ship?
Write to `licensing@linksense.org` and we will make it.

**The icon-only marks in `docs/brand/` are not attribution marks.** They are app icons
— favicon, PWA, browser tab. Using one for attribution would leave the name nowhere in
the notice, since the phrase is only "Powered by".

---

## 5. Typography

**We do not specify a typeface. The notice inherits your application's font.**

That is deliberate. This is a credit line, not a brand lockup: one that imports a
webfont to look "correct" is an external dependency that fails in exactly the
air-gapped deployments this product is built for, and a licensed typeface would make
compliance impossible for you. Matching your interface is the right outcome.

What we do ask for is a legibility floor:

| Property | Requirement |
|---|---|
| Effective font size | at least 12px |
| Contrast against its background | at least 4.5:1 (WCAG AA for body text) |
| Opacity / scaling | not used to make the notice effectively invisible |
| Spelling | `LinkSense` — one word, capital L and capital S |

Weight, colour, letter-spacing and placement are yours to choose.

---

## 6. When no attribution is required

- Your use produces no graphical interface (CLI, headless, API-only)
- You hold a commercial license or our written waiver (§6 of the additional
  permissions)

**Internal deployment is not on this list.** The Internal Deployment Exception waives
the *source disclosure* obligation (§15), not the *attribution* obligation (§14). The
triggers differ — see the table at the top.

---

## 7. Your own branding

**Rebranding the product is fine and needs no permission.** Change the product name,
put your own logo in the header, restyle it, translate it, call it what your
organization calls it. The License does not restrict any of that, and we would rather
you deployed it under a name your colleagues recognise.

What stays is the notice itself: `Powered by` plus the LinkSense mark, 18–24px, in the
attribution area at the foot of the interface. **Your name at the top, ours at the
bottom** — that combination is compliant, and it is the normal case. See
[`LICENSE-EXCEPTIONS.md`](./LICENSE-EXCEPTIONS.md) §5.

**Need the notice gone entirely** — shipping LinkSense inside a product of your own,
reselling it, or running it as a service under another brand with no attribution? That
is a commercial arrangement rather than a formality. Write to `licensing@linksense.org`.
See [`LICENSE-EXCEPTIONS.md`](./LICENSE-EXCEPTIONS.md) §6.

---

## 8. For maintainers: source file headers

The source notice requirements are in Section 3.5 and Exhibit A of `LICENSE`.
Keep the completed license and `NOTICE` with distributed source and images.

---

*Published by Infocare Hong Kong Limited as the official interpretation of Section 14 of
CPAL-1.0.*
