# ALPR Layer for Google Maps — POC 0.0.6

Chrome extension POC that adds Flock Safety ALPR camera locations directly on the real `google.com/maps` experience.

## No API keys required

This does not use the Google Maps JavaScript API. Camera data comes from the public DeFlock/OpenStreetMap-derived dataset.

## Install / update

1. Unzip the download.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Remove or disable the older ALPR POC extension first.
5. Click **Load unpacked** and select the `alpr-google-maps-poc` folder from this ZIP.
6. Reload Google Maps.

## 0.0.5 changes

- Keeps the Flock camera marker as a **red dot**.
- Direction cones keep the same fixed screen-space size as 0.0.3.
- Removes the cone outline/stroke entirely.
- Cone fill now starts at **30% opacity at the camera** and smoothly fades to **0% at the far edge**.
- Main lower-left control is now a true **74 × 74 px square**.
- Adds a small **cone toggle** inside the square so direction cones can be hidden/shown independently.
- Clicking the main square still toggles the complete Flock layer (dots + cones) exactly as before.
- Cone visibility preference is remembered across reloads.

## Notes

- Cameras without direction metadata still show a dot but cannot show a meaningful cone.
- The cone communicates recorded direction, not a verified physical detection range or exact optical field of view.
- Standard north-up 2D Google Maps remains the target for this POC.

Camera data: © OpenStreetMap contributors, ODbL; surfaced through the DeFlock data pipeline.

`Flock Safety` is used descriptively to identify the camera manufacturer/brand. This extension is not affiliated with or endorsed by Flock Safety or Google.


## 0.0.5 visual tweaks
- Lower-left Flock control enlarged to 79×79 px and kept square.
- Flock label is left-aligned so the cone toggle does not overlap it.
- Camera markers use a compact black eye glyph instead of the white center dot.
- Direction cones keep the same geometry, with no stroke, and fade from 50% opacity at the camera to 10% at the far edge.


## 0.0.6 final submission tweak
- Changes the eye glyph inside the red camera marker from black to white for cleaner contrast.
