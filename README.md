# Coriolis

Weather events, drawn as dots. Cyclones as the satellite sees them, an eye, an eyewall and rainbands spiralling in, spinning the right way for their hemisphere. Cumulus and roll clouds from the side. Thunderstorms at night, lit from inside by their own lightning, lightning on its own, tornadoes from rope to wedge, the aurora, rain and snow. Forty-five named events. Canvas 2D, no dependencies, one script.

Sister library to [Ephemeris](https://github.com/TonkaTuff/ephemeris), and the dots are sized to match, so the two sit together on a page.

## Use it

```html
<script src="https://cdn.jsdelivr.net/gh/TonkaTuff/coriolis@v0.5.0/dist/coriolis.min.js"></script>
<canvas class="wx" width="200" height="200" data-wx-body="tracy"></canvas>
```

Every `canvas.wx` on the page mounts itself. Height sets the storm's size; a wider canvas gives its outer bands room. Add canvases later with `Coriolis.register()`.

One event at a time, if that's all you need: `dist/<name>.min.js` is the core plus that event's mode and nothing else.

## Events

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
| Clouds | `cumulus` | fair-weather heads that drift along and tumble forward |
| | `morning-glory` | the Gulf of Carpentaria's roll cloud, up to a thousand km long, turning about its own axis as it comes |
| | `shelf-cloud` | the low dark leading edge of a squall line |
| Thunderstorms | `thunderstorm` | a cumulonimbus at night, lit from inside |
| | `supercell` | a wide anvil and more strikes to the ground |
| | `hector` | the Tiwi Islands' storm, up most afternoons of the build-up |
| | `catatumbo` | Lake Maracaibo, the most lightning on Earth, nearly all of it inside the cloud |
| Lightning | `fork-lightning` | a big strike to the ground: the stepped leader feels its way down, then the return stroke |
| | `anvil-crawler` | a bolt spidering sideways along a cloud base |
| | `sheet-lightning` | a cloud lit from inside, no channel to see |
| | `ball-lightning` | a glowing sphere that swells in, drifts, pulses, sheds sparks and bursts |
| | `megaflash` | the 2020 record, 768 km from Texas to Mississippi, as a long crawler |
| Tornadoes | `tornado` | a funnel from the cloud base to the ground, snaking as it goes, dust at its foot |
| | `el-reno` | 2013, Oklahoma. 4.2 km wide, the widest on record, with sub-vortices inside |
| | `tri-state` | 1925, Missouri to Indiana. 350 km, the longest track on record |
| | `joplin` | 2011, Missouri. EF5, multiple vortices |
| | `bridge-creek` | 1999, Oklahoma. 486 km/h, the fastest wind ever measured |
| | `waterspout` | a thin funnel over the sea, spray at its foot |
| | `dust-devil` | no cloud: a column of dust, widest at the ground |
| | `fire-whirl` | a vortex of flame and embers |
| Aurora | `aurora-australis` | green below, purple above, folding and shimmering |
| | `aurora-borealis` | green curtains with red tops |
| | `carrington` | 1859, the biggest solar storm on record: red skies down to the tropics |
| | `may-2024` | the storm of May 2024: pink curtains seen from the suburbs the world over |
| Rain and snow | `rain` | streaks with a little wind in them |
| | `drizzle` | fine and slow |
| | `monsoon` | the wet: heavy, slanted, everywhere |
| | `snow` | flakes that drift and sway |
| | `blizzard` | snow going sideways |
| | `hail` | stones that fall hard and bounce |

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
| `data-wx-form` | `puff`, `roll` | clouds: cumulus heads, or one rolling tube |
| `data-wx-puffs` | number | clouds: how many heads, 3 by default |
| `data-wx-radius` | number | clouds: size as a fraction of the height, 0.2 by default |
| `data-wx-spin` | number | clouds: roll or tumble rate in radians a second |
| `data-wx-drift` | number | clouds: drift in canvas widths a second, 0.04 by default |
| `data-wx-rate` | number | thunderstorm: flashes a second, 0.6 by default |
| `data-wx-cg` | 0–1 | thunderstorm: share of flashes that strike the ground, 0.5 by default |
| `data-wx-anvil`, `data-wx-tower` | number | thunderstorm: anvil width and tower height, 1 by default |
| `data-wx-rain` | `0` | thunderstorm: no rain under the base |
| `data-wx-form` | `fork`, `crawler`, `sheet`, `ball` | lightning: a strike to the ground, one along the cloud base, a cloud lit from inside, or ball lightning |
| `data-wx-branches` | number | lightning: forks off the channel, 6 by default |
| `data-wx-life` | seconds | ball lightning: one life, 8 by default |
| `data-wx-rate` | number | lightning too: strikes a second, 0.7 by default |
| `data-wx-form` | `tornado`, `waterspout`, `dust-devil`, `fire-whirl` | tornado: a funnel with dust, one with spray, a column of dust with no cloud, or a vortex of embers |
| `data-wx-width` | number | tornado: width as a fraction of the height, 0.16 by default |
| `data-wx-taper` | number | tornado: 2 is a rope, 0.3 a wedge; 1.4 by default |
| `data-wx-sway` | number | tornado: how far the foot wanders, 0.12 by default |
| `data-wx-vortices` | number | tornado: sub-vortices orbiting inside, 1 by default |
| `data-wx-debris` | 0–1 | tornado: dust as a share of the dots, 0.4 by default |
| `data-wx-spin` | number | tornado too: turns a second at the base, 2.2 by default |
| `data-wx-bands` | number | aurora too: curtains, 2 by default |
| `data-wx-height` | number | aurora: ray height as a fraction of the canvas, 0.45 by default |
| `data-wx-shimmer` | number | aurora: how fast the rays flicker, 1 by default |
| `data-wx-form` | `rain`, `snow`, `hail` | precip: streaks, flakes, or stones that bounce |
| `data-wx-density` | number | precip: how much, 1 by default |
| `data-wx-speed` | number | precip: fall speed in canvas heights a second |
| `data-wx-wind` | number | precip: sideways slant, 0.35 for rain and 0.15 for snow by default |
| `data-wx-ink` | `1` | monochrome dots that follow the page theme |
| `data-wx-lite` | `1` | half the dots |
| `data-wx-ground` | `1` | a pill of sea or sky behind it; each event brings its own, or pass `sky: ['#top', '#bottom']` in JavaScript |
| `data-wx-glow` | `0` | no soft glow under the core, just the dots on a clear canvas |

Colours come from CSS custom properties, inherited, so a theme can set them once: `--wx-cold`, `--wx-mid`, `--wx-hot` for the cloud ramp (low, thin cloud to the highest tops) and `--wx-glow` for the light under the core.

## JavaScript

```js
Coriolis.body('yasi', ctx, 200, t, dark, { w: 400, ground: true });   // draw one frame yourself
Coriolis.draw('cyclone', ctx, 200, t, dark, { hemisphere: 'south', cat: 3 });
Coriolis.GROUPS;   // { Cyclones: [...], Hurricanes: [...], Typhoons: [...] }
```

`opts`: `w` canvas width (default = size), `ink`, `lite`, `ground`, `glow` (false skips the soft gradient), `palette`, `sky`, plus the knobs above by name. In markup any `data-wx-<knob>` reaches the mode as `opts.knob`, numbers parsed.

## Build

`npm run build` writes `dist/coriolis.min.js` and one `dist/<name>.min.js` per event. `tools/verify.html` and `tools/verify-min.html`, served over http, check every bundle draws pixel-identical to the source.

MIT.
