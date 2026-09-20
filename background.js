const DATA_URL = "https://data.dontgetflocked.com/cameras.geojson.gz";
const GRID_SIZE = 0.25;
const MAX_RESULTS = 1200;

let loadPromise = null;
let grid = null;
let cameraCount = 0;
let loadedAt = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "ALPR_QUERY") return;

  queryCameras(message.bbox)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));

  return true;
});

async function queryCameras(bbox) {
  if (!isValidBbox(bbox)) throw new Error("Invalid map bounds");
  await ensureLoaded();

  const [west, south, east, north] = bbox;
  const hits = [];

  const pushRange = (rangeWest, rangeEast) => {
    const x0 = Math.floor((rangeWest + 180) / GRID_SIZE);
    const x1 = Math.floor((rangeEast + 180) / GRID_SIZE);
    const y0 = Math.floor((south + 90) / GRID_SIZE);
    const y1 = Math.floor((north + 90) / GRID_SIZE);

    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const bucket = grid.get(`${gx}:${gy}`);
        if (!bucket) continue;

        for (const camera of bucket) {
          if (
            camera.lat >= south &&
            camera.lat <= north &&
            camera.lng >= rangeWest &&
            camera.lng <= rangeEast
          ) {
            hits.push(camera);
            if (hits.length >= MAX_RESULTS) return true;
          }
        }
      }
    }
    return false;
  };

  if (west <= east) {
    pushRange(west, east);
  } else {
    if (!pushRange(west, 180)) pushRange(-180, east);
  }

  return {
    cameras: hits,
    totalFlockCamerasLoaded: cameraCount,
    truncated: hits.length >= MAX_RESULTS,
    loadedAt
  };
}

async function ensureLoaded() {
  if (grid) return;
  if (!loadPromise) loadPromise = loadAndIndex();

  try {
    await loadPromise;
  } catch (error) {
    loadPromise = null;
    throw error;
  }
}

async function loadAndIndex() {
  const response = await fetch(DATA_URL, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Camera data request failed (${response.status})`);

  let bytes = new Uint8Array(await response.arrayBuffer());

  // Some servers automatically decode Content-Encoding:gzip; others serve the
  // .gz bytes directly. Only decompress when the gzip magic bytes are present.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This Chrome version cannot decompress the camera dataset");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const text = new TextDecoder().decode(bytes);
  const geojson = JSON.parse(text);
  if (!Array.isArray(geojson?.features)) throw new Error("Unexpected camera data format");

  const nextGrid = new Map();
  let nextCount = 0;

  for (const feature of geojson.features) {
    if (feature?.geometry?.type !== "Point") continue;
    const [lng, lat] = feature.geometry.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const props = feature.properties || {};
    if (!isFlock(props)) continue;

    const camera = {
      lat,
      lng,
      brand: displayBrand(props),
      direction: normalizeDirection(props.direction ?? props.bearing ?? props.angle),
      operator: firstString(props.operator, props.owner, props.agency),
      osmId: firstString(props.osmId, props.osm_id, feature.id),
      rawBrand: firstString(
        props.brand,
        props.manufacturer,
        props.vendor,
        props["camera:brand"],
        props["surveillance:brand"]
      )
    };

    const gx = Math.floor((lng + 180) / GRID_SIZE);
    const gy = Math.floor((lat + 90) / GRID_SIZE);
    const key = `${gx}:${gy}`;
    let bucket = nextGrid.get(key);
    if (!bucket) nextGrid.set(key, (bucket = []));
    bucket.push(camera);
    nextCount++;
  }

  grid = nextGrid;
  cameraCount = nextCount;
  loadedAt = Date.now();
}

function isFlock(props) {
  const values = [
    props.brand,
    props.manufacturer,
    props.vendor,
    props.operator,
    props["camera:brand"],
    props["surveillance:brand"],
    props["surveillance:manufacturer"]
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return values.includes("flock");
}

function displayBrand(props) {
  const raw = firstString(
    props.brand,
    props.manufacturer,
    props.vendor,
    props["camera:brand"],
    props["surveillance:brand"]
  );
  return raw || "Flock Safety";
}

function firstString(...values) {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return value ? value.trim() : null;
}

function normalizeDirection(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return ((value % 360) + 360) % 360;
  const text = String(value).trim().toUpperCase();
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return ((numeric % 360) + 360) % 360;

  const cardinal = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
    E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
    W: 270, WNW: 292.5, NW: 315, NNW: 337.5
  };
  return cardinal[text] ?? null;
}

function isValidBbox(bbox) {
  return (
    Array.isArray(bbox) &&
    bbox.length === 4 &&
    bbox.every(Number.isFinite) &&
    bbox[1] >= -90 && bbox[1] <= 90 &&
    bbox[3] >= -90 && bbox[3] <= 90
  );
}
