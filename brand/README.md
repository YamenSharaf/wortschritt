# Wortschritt icon

Little steps up, with three dots climbing them (blue → white steps, dots
yellow → coral → pink). Sources for every icon the app ships:

| File | Use |
|---|---|
| `wortschritt-mark.svg` | The mark alone, transparent; lighter blue in dark mode. The web favicon and header logo (`packages/web/public/favicon.svg` is a copy). |
| `wortschritt-icon.svg` | App icon: white mark on the blue gradient tile, full bleed (apple-touch icon, PWA maskable icon). |
| `wortschritt-icon-rounded.svg` | The same with rounded corners (PWA "any" icons, README). |
| `android-foreground.svg`, `android-background.svg`, `android-monochrome.svg` | Android adaptive icon layers (108dp canvas; the mark sits well inside the 66dp safe zone). Convert to vector drawables for `ic_launcher`. |

The PNGs in `packages/web/public/` were rendered from these with resvg
(`apple-touch-icon.png` 180 px from `wortschritt-icon.svg`, `icon-192.png` /
`icon-512.png` from the rounded one, `icon-maskable-512.png` from the full-bleed one).
