(() => {
  const MIN_ZOOM = 11;
  const QUERY_DEBOUNCE_MS = 320;
  const RENDER_INTERVAL_MS = 55;

  let enabled = true;
  let root;
  let overlay;
  let controlWrap;
  let toggle;
  let coneToggle;
  let conesEnabled = true;
  let status;
  let attribution;
  let infoCard;
  let cameras = [];
  let lastStateKey = "";
  let lastQueryKey = "";
  let queryTimer = null;
  let renderTimer = null;
  let selectedMarker = null;

  init();

  async function init() {
    const saved = await chrome.storage.local.get(["alprEnabled", "alprConesEnabled"]);
    enabled = saved.alprEnabled ?? true;
    conesEnabled = saved.alprConesEnabled ?? true;
    mountUi();
    updateToggle();
    startLoop();
  }

  function mountUi() {
    const existing = document.querySelector("#alpr-layer-root");
    if (existing) existing.remove();

    root = document.createElement("div");
    root.id = "alpr-layer-root";
    root.innerHTML = `
      <div id="alpr-camera-overlay"></div>
      <div id="alpr-control-wrap">
        <button id="alpr-layer-toggle" type="button" aria-pressed="true" title="Toggle Flock ALPR cameras">
          <span class="alpr-toggle-visual" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M7 7.5h2.1l1-1.8h3.8l1 1.8H17c1.7 0 3 1.3 3 3v5.5c0 1.7-1.3 3-3 3H7c-1.7 0-3-1.3-3-3v-5.5c0-1.7 1.3-3 3-3Z"/>
              <circle cx="12" cy="13" r="3.2"/>
            </svg>
          </span>
          <span class="alpr-toggle-label">Flock</span>
          <span class="alpr-toggle-count" aria-hidden="true"></span>
        </button>
        <button id="alpr-cone-toggle" type="button" aria-pressed="true" title="Hide direction cones" aria-label="Hide direction cones">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 12 L19 5.2 A15.2 15.2 0 0 1 19 18.8 Z"/>
            <circle cx="6" cy="12" r="2"/>
          </svg>
        </button>
      </div>
      <div id="alpr-layer-status" role="status"></div>
      <div id="alpr-layer-attribution">Camera data © OpenStreetMap contributors · via DeFlock</div>
      <div id="alpr-info-card" hidden></div>
    `;
    document.documentElement.appendChild(root);

    overlay = root.querySelector("#alpr-camera-overlay");
    controlWrap = root.querySelector("#alpr-control-wrap");
    toggle = root.querySelector("#alpr-layer-toggle");
    coneToggle = root.querySelector("#alpr-cone-toggle");
    status = root.querySelector("#alpr-layer-status");
    attribution = root.querySelector("#alpr-layer-attribution");
    infoCard = root.querySelector("#alpr-info-card");

    toggle.addEventListener("click", async () => {
      enabled = !enabled;
      await chrome.storage.local.set({ alprEnabled: enabled });
      updateToggle();
      if (!enabled) {
        cameras = [];
        overlay.replaceChildren();
        closeInfo();
        status.textContent = "";
      } else {
        lastQueryKey = "";
        scheduleQuery(true);
      }
    });

    coneToggle.addEventListener("click", async (event) => {
      event.stopPropagation();
      conesEnabled = !conesEnabled;
      await chrome.storage.local.set({ alprConesEnabled: conesEnabled });
      updateToggle();
      root.classList.toggle("cones-off", !conesEnabled);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeInfo();
    });

    positionControl();
  }

  function updateToggle() {
    toggle?.setAttribute("aria-pressed", String(enabled));
    toggle?.classList.toggle("is-off", !enabled);
    attribution.hidden = !enabled;
    root?.classList.toggle("cones-off", !conesEnabled);

    if (coneToggle) {
      coneToggle.setAttribute("aria-pressed", String(conesEnabled));
      coneToggle.classList.toggle("is-off", !conesEnabled);
      coneToggle.disabled = !enabled;
      const label = conesEnabled ? "Hide direction cones" : "Show direction cones";
      coneToggle.title = label;
      coneToggle.setAttribute("aria-label", label);
    }
  }

  function startLoop() {
    renderTimer = setInterval(() => {
      if (!document.documentElement.contains(root)) mountUi();
      positionControl();

      const state = getMapState();
      if (!state) {
        if (enabled) status.textContent = "Open a standard 2D Google Maps view";
        overlay.replaceChildren();
        return;
      }

      const stateKey = `${state.lat.toFixed(6)}:${state.lng.toFixed(6)}:${state.zoom.toFixed(2)}:${Math.round(state.rect.width)}:${Math.round(state.rect.height)}`;
      if (stateKey !== lastStateKey) {
        lastStateKey = stateKey;
        if (enabled) scheduleQuery(false);
      }

      if (enabled) render(state);
    }, RENDER_INTERVAL_MS);
  }

  function positionControl() {
    if (!controlWrap) return;

    // Keep our control deliberately in Google's lower-left map-control area.
    // If the native Layers tile is found, sit immediately to its right.
    const nativeLayers = findNativeLayersControl();
    let left = 144;
    let bottom = 18;

    if (nativeLayers) {
      const rect = nativeLayers.getBoundingClientRect();
      left = Math.round(rect.right + 10);
      bottom = Math.max(10, Math.round(window.innerHeight - rect.bottom));
    }

    // Inline !important rules prevent Google page styles from pushing the
    // extension back to the right-side control stack.
    controlWrap.style.setProperty("left", `${left}px`, "important");
    controlWrap.style.setProperty("right", "auto", "important");
    controlWrap.style.setProperty("top", "auto", "important");
    controlWrap.style.setProperty("bottom", `${bottom}px`, "important");
    root.style.setProperty("--alpr-control-left", `${left}px`);
    root.style.setProperty("--alpr-control-bottom", `${bottom}px`);
  }

  function findNativeLayersControl() {
    const candidates = document.querySelectorAll('button, [role="button"], div');
    let best = null;
    let bestScore = Infinity;

    for (const el of candidates) {
      if (el === toggle || el === coneToggle || root?.contains(el)) continue;
      const label = `${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("data-tooltip") || ""} ${el.textContent || ""}`
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (!(label === "layers" || label.startsWith("layers ") || label.includes(" layers"))) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 35 || rect.width > 150 || rect.height > 130) continue;
      if (rect.left > 240 || rect.bottom < window.innerHeight - 180) continue;

      // Prefer the visible tile nearest the lower-left corner.
      const score = Math.abs(rect.left - 55) + Math.abs(window.innerHeight - rect.bottom - 18);
      if (score < bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  function scheduleQuery(immediate) {
    clearTimeout(queryTimer);
    queryTimer = setTimeout(queryVisibleCameras, immediate ? 0 : QUERY_DEBOUNCE_MS);
  }

  async function queryVisibleCameras() {
    if (!enabled) return;
    const state = getMapState();
    if (!state) return;

    if (state.zoom < MIN_ZOOM) {
      cameras = [];
      overlay.replaceChildren();
      status.textContent = "Zoom in to see Flock cameras";
      setCount(null);
      return;
    }

    const bbox = viewportBbox(state);
    const queryKey = bbox.map((n) => n.toFixed(4)).join(":");
    if (queryKey === lastQueryKey) return;
    lastQueryKey = queryKey;

    status.textContent = "Loading Flock cameras…";
    try {
      const response = await chrome.runtime.sendMessage({ type: "ALPR_QUERY", bbox });
      if (!response?.ok) throw new Error(response?.error || "Camera data unavailable");
      cameras = response.cameras || [];
      status.textContent = response.truncated ? "Showing first 1,200 cameras in view" : "";
      setCount(cameras.length);
      render(state);
    } catch (error) {
      console.warn("[ALPR Layer]", error);
      status.textContent = "Couldn’t load camera data";
      cameras = [];
      setCount(null);
    }
  }

  function render(state) {
    if (!enabled || state.zoom < MIN_ZOOM) return;

    const fragment = document.createDocumentFragment();
    const visibleIds = new Set();

    for (let i = 0; i < cameras.length; i++) {
      const camera = cameras[i];
      const point = project(camera.lat, camera.lng, state);
      if (!point) continue;
      if (
        point.x < state.rect.left - 120 ||
        point.x > state.rect.right + 120 ||
        point.y < state.rect.top - 120 ||
        point.y > state.rect.bottom + 120
      ) continue;

      const id = `${camera.osmId || i}:${camera.lat}:${camera.lng}`;
      visibleIds.add(id);
      let marker = overlay.querySelector(`[data-camera-id="${cssEscape(id)}"]`);
      if (!marker) {
        marker = createMarker(camera, id);
        fragment.appendChild(marker);
      }
      marker.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0)`;
      marker.style.setProperty("--camera-bearing", `${camera.direction ?? 0}deg`);
      marker.classList.toggle("has-direction", Number.isFinite(camera.direction));
    }

    for (const child of [...overlay.children]) {
      if (!visibleIds.has(child.dataset.cameraId)) {
        if (child === selectedMarker) selectedMarker = null;
        child.remove();
      }
    }
    overlay.appendChild(fragment);
  }

  function createMarker(camera, id) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "alpr-camera-marker";
    marker.dataset.cameraId = id;
    marker.title = "Flock Safety ALPR camera";
    marker.setAttribute("aria-label", "Flock Safety ALPR camera");
    const gradientId = `alpr-cone-gradient-${simpleHash(id)}`;
    marker.innerHTML = `
      <svg class="alpr-camera-cone" viewBox="0 0 220 220" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="${gradientId}" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#1a73e8" stop-opacity="0.50"/>
            <stop offset="24%" stop-color="#1a73e8" stop-opacity="0.44"/>
            <stop offset="62%" stop-color="#1a73e8" stop-opacity="0.26"/>
            <stop offset="100%" stop-color="#1a73e8" stop-opacity="0.10"/>
          </radialGradient>
        </defs>
        <path d="M110 110 L30.3 43.1 A104 104 0 0 1 189.7 43.1 Z" fill="url(#${gradientId})"/>
      </svg>
      <span class="alpr-camera-dot" aria-hidden="true">
        <svg class="alpr-camera-eye" viewBox="0 0 14 12" aria-hidden="true" focusable="false">
          <path d="M1.2 6s2.15-3.35 5.8-3.35S12.8 6 12.8 6 10.65 9.35 7 9.35 1.2 6 1.2 6Z"/>
          <circle cx="7" cy="6" r="1.65"/>
        </svg>
      </span>
    `;
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      selectMarker(marker);
      showInfo(camera, marker);
    });
    return marker;
  }

  function selectMarker(marker) {
    if (selectedMarker && selectedMarker !== marker) selectedMarker.classList.remove("is-selected");
    selectedMarker = marker;
    selectedMarker.classList.add("is-selected");
  }

  function closeInfo() {
    if (infoCard) infoCard.hidden = true;
    if (selectedMarker) selectedMarker.classList.remove("is-selected");
    selectedMarker = null;
  }

  function showInfo(camera, marker) {
    const rect = marker.getBoundingClientRect();
    const directionText = Number.isFinite(camera.direction)
      ? `${cardinalDirection(camera.direction)} · ${Math.round(camera.direction)}°`
      : "Unknown";

    infoCard.innerHTML = `
      <button class="alpr-info-close" type="button" aria-label="Close">×</button>
      <div class="alpr-info-eyebrow">ALPR CAMERA</div>
      <div class="alpr-info-title">Flock Safety</div>
      <dl>
        <div><dt>Direction</dt><dd>${escapeHtml(directionText)}</dd></div>
        ${camera.operator ? `<div><dt>Operator</dt><dd>${escapeHtml(camera.operator)}</dd></div>` : ""}
        ${camera.osmId ? `<div><dt>OSM ID</dt><dd>${escapeHtml(camera.osmId)}</dd></div>` : ""}
      </dl>
      <div class="alpr-info-source">OpenStreetMap-derived data via DeFlock</div>
    `;
    infoCard.style.left = `${Math.min(window.innerWidth - 300, Math.max(12, rect.left - 120))}px`;
    infoCard.style.top = `${Math.min(window.innerHeight - 220, Math.max(12, rect.top + 24))}px`;
    infoCard.hidden = false;
    infoCard.querySelector(".alpr-info-close").addEventListener("click", closeInfo);
  }

  function cardinalDirection(degrees) {
    const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return labels[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
  }

  function getMapState() {
    const parsed = parseCenterAndZoom(location.href);
    if (!parsed) return null;
    const rect = findMapRect();
    if (!rect || rect.width < 300 || rect.height < 240) return null;
    return { ...parsed, rect };
  }

  function parseCenterAndZoom(url) {
    // Normal Google Maps URLs contain /@LAT,LNG,ZOOMz/.
    const match = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
    if (!match) return null;
    return {
      lat: Number(match[1]),
      lng: Number(match[2]),
      zoom: Number(match[3])
    };
  }

  function findMapRect() {
    // Prefer Google's large WebGL/canvas map surface. This avoids treating the
    // left search/results panel as part of the geographic viewport.
    let best = null;
    let bestArea = 0;
    for (const canvas of document.querySelectorAll("canvas")) {
      const rect = canvas.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (rect.width >= 300 && rect.height >= 240 && area > bestArea) {
        best = rect;
        bestArea = area;
      }
    }

    if (best) return best;
    return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function viewportBbox(state) {
    const center = mercatorWorld(state.lat, state.lng, state.zoom);
    const halfW = state.rect.width / 2;
    const halfH = state.rect.height / 2;
    const nw = inverseWorld(center.x - halfW, center.y - halfH, state.zoom);
    const se = inverseWorld(center.x + halfW, center.y + halfH, state.zoom);
    return [nw.lng, se.lat, se.lng, nw.lat];
  }

  function project(lat, lng, state) {
    const center = mercatorWorld(state.lat, state.lng, state.zoom);
    const point = mercatorWorld(lat, lng, state.zoom);
    const worldSize = 256 * 2 ** state.zoom;
    let dx = point.x - center.x;
    if (dx > worldSize / 2) dx -= worldSize;
    if (dx < -worldSize / 2) dx += worldSize;

    return {
      x: state.rect.left + state.rect.width / 2 + dx,
      y: state.rect.top + state.rect.height / 2 + (point.y - center.y)
    };
  }

  function mercatorWorld(lat, lng, zoom) {
    const worldSize = 256 * 2 ** zoom;
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const sin = Math.sin((clampedLat * Math.PI) / 180);
    return {
      x: ((lng + 180) / 360) * worldSize,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize
    };
  }

  function inverseWorld(x, y, zoom) {
    const worldSize = 256 * 2 ** zoom;
    const lng = (x / worldSize) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / worldSize;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
    return { lat, lng: normalizeLng(lng) };
  }

  function normalizeLng(lng) {
    return ((lng + 180) % 360 + 360) % 360 - 180;
  }

  function setCount(count) {
    const el = toggle?.querySelector(".alpr-toggle-count");
    if (!el) return;
    el.textContent = Number.isFinite(count) && count > 0 ? String(count) : "";
  }

  function simpleHash(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
