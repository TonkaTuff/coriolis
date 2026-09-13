# Coriolis

Weather events, drawn as dots. Named cyclones, hurricanes and typhoons as the satellite sees them: an eye, an eyewall, a solid overcast over the core and rainbands spiralling in. Each one spins the right way for its hemisphere. Canvas 2D, no dependencies, one script.

Sister library to [Ephemeris](https://github.com/TonkaTuff/ephemeris), and the dots are sized to match, so the two sit together on a page.

## Use it

```html
<script src="https://cdn.jsdelivr.net/gh/TonkaTuff/coriolis@v0.1.0/dist/coriolis.min.js"></script>
<canvas class="wx" width="200" height="200" data-wx-body="tracy"></canvas>
```

Every `canvas.wx` on the page mounts itself. Height sets the storm's size; a wider canvas gives its outer bands room. Add canvases later with `Coriolis.register()`.

One storm at a time, if that's all you need: `dist/<storm>.min.js` is the core plus that storm and nothing else.

## Storms

| Basin | Name | Year, place, and what marks it out |
|---|---|---|
| Cyclones | `tracy` | 1974, Darwin. Category 4 and one of the smallest on record |
| | `yasi` | 2011, Queensland. Category 5, enormous |
| | `larry` | 2006, Queensland. Category 4 |
| | `debbie` | 2017, Queensland. Category 4 with a wide eye |
| | `winston` | 2016, Fiji. Category 5, the strongest landfall south of the equator |
| | `freddy` | 2023, Mozambique. The longest-lived tropical cyclone recorded |
| | `alfred` | 2025, Queensland. Category 2, ragged and lopsided |
| Hurricanes | `katrina` | 2005, the Gulf of Mexico. Category 5 at sea |
| | `andrew` | 1992, Florida. Category 5, compact |
| | `wilma` | 2005, the Caribbean. The smallest eye ever measured |
| | `sandy` | 2012, the US east coast. Huge, no eye, half hurricane half winter storm |
| | `patricia` | 2015, the eastern Pacific. The strongest winds ever measured, pinhole eye |
| | `dorian` | 2019, the Bahamas. Category 5, a textbook eye |
| Typhoons | `haiyan` | 2013, the Philippines. Category 5 |
| | `tip` | 1979, the western Pacific. The largest storm ever recorded |

Cyclones spin clockwise, hurricanes and typhoons anticlockwise. That's the Coriolis effect, and the library's name.

## Knobs

| attribute | value | what it does |
|---|---|---|
| `data-wx-body` | storm | one of the names above |
| `data-wx-hemisphere` | `north`, `south` | south spins clockwise |
| `data-wx-cat` | 1–5 | how organised: 5 has a pinhole eye and crisp bands, 1 is a ragged lump thrown to one side |
| `data-wx-eye` | number | eye radius as a fraction of the storm, 0 for none |
| `data-wx-bands` | number | rainbands, 2 to 4 |
| `data-wx-pitch` | degrees | inflow angle, 22 by default; lower winds the bands tighter |
| `data-wx-reach` | number | storm size relative to the canvas, 1 fills it |
| `data-wx-omega` | number | wind at the eyewall in radians a second, 1.1 by default |
| `data-wx-ink` | `1` | monochrome dots that follow the page theme |
| `data-wx-lite` | `1` | half the dots |
| `data-wx-ground` | `1` | a pill of dark sea under the cloud |
| `data-wx-glow` | `0` | no soft glow under the core, just the dots on a clear canvas |

Colours come from CSS custom properties, inherited, so a theme can set them once: `--wx-cold`, `--wx-mid`, `--wx-hot` for the cloud ramp (low, thin cloud to the highest tops) and `--wx-glow` for the light under the core.

## JavaScript

```js
Coriolis.body('yasi', ctx, 200, t, dark, { w: 400, ground: true });   // draw one frame yourself
Coriolis.draw('cyclone', ctx, 200, t, dark, { hemisphere: 'south', cat: 3 });
Coriolis.GROUPS;   // { Cyclones: [...], Hurricanes: [...], Typhoons: [...] }
```

`opts`: `w` canvas width (default = size), `ink`, `lite`, `ground`, `glow` (false skips the soft gradient), `palette`, plus the knobs above by name.

## Build

`npm run build` writes `dist/coriolis.min.js` and one `dist/<storm>.min.js` per storm. `tools/verify.html` and `tools/verify-min.html`, served over http, check every bundle draws pixel-identical to the source.

MIT.
