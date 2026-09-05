// ─── Map Initialization ──────────────────────────────────────────────────────
const worldBounds = L.latLngBounds(L.latLng(-90, -180), L.latLng(90, 180));

// Leaflet sub-pixel tile seam fix (NoGap patch)
// Eliminates 1px white/dark vertical and horizontal grid lines between map tiles
(function() {
    if (typeof L !== 'undefined' && L.GridLayer) {
        const originalInitTile = L.GridLayer.prototype._initTile;
        L.GridLayer.include({
            _initTile: function(tile) {
                originalInitTile.call(this, tile);
                const tileSize = this.getTileSize();
                tile.style.width = (tileSize.x + 1) + 'px';
                tile.style.height = (tileSize.y + 1) + 'px';
            }
        });
    }
})();

const map = L.map('map', {
    preferCanvas: true, // Hardware-accelerated Canvas rendering for zero lag on 4000+ points
    zoomControl: false,
    minZoom: 2.75, // Zoomed in enough so satellite imagery covers 100% of canvas with NO "Map data not available"
    maxZoom: 18,
    maxBounds: [[-62, -220], [70, 220]], // Confines view to inhabited regions; blocks polar "no data" tiles
    maxBoundsViscosity: 0.9,
    zoomSnap: 0.1, // Smooth fractional zoom
    zoomDelta: 0.5,
    closePopupOnClick: false // Prevents clicks on map from closing popups!
}).setView([20.0, 15.0], 2.9);
map.options.closePopupOnClick = false;

// Satellite base layer (seamless wrapping to cover entire canvas edge-to-edge)
const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri', maxZoom: 19 }
).addTo(map);

// Dark map overlay for hybrid view (contains the map text/labels)
const darkOverlay = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; CartoDB', opacity: 0.65, maxZoom: 19 }
).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

// Fullscreen Control
const fullScreenControl = L.control({ position: 'bottomright' });
fullScreenControl.onAdd = function() {
    const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-fullscreen');
    div.innerHTML = `<a href="#" title="Toggle Fullscreen" onclick="window.toggleFullScreen(event)">⛶</a>`;
    return div;
};
fullScreenControl.addTo(map);

window.isFullScreen = false;
window.toggleFullScreen = function(e) {
    if (e && e.preventDefault) e.preventDefault();
    window.isFullScreen = !window.isFullScreen;
    const sidebar = document.querySelector('.sidebar');
    const expandBtnIcon = document.getElementById('expand-btn-icon');
    if (window.isFullScreen) {
        sidebar.classList.add('fullscreen-hide');
        if (expandBtnIcon) expandBtnIcon.innerText = '⤢ Exit Full';
        document.getElementById('critical-alert').style.left = '50%';
    } else {
        sidebar.classList.remove('fullscreen-hide');
        if (expandBtnIcon) expandBtnIcon.innerText = '⛶ Expand';
        // Reset to responsive centering logic
        if (window.innerWidth > 992) {
            document.getElementById('critical-alert').style.left = 'calc(360px + (100vw - 360px) / 2)';
        }
    }
    // Keep map perfectly synced during the 400ms CSS slide animation
    const resizeInterval = setInterval(() => map.invalidateSize(), 20);
    setTimeout(() => {
        clearInterval(resizeInterval);
        map.invalidateSize();
        if (window.fitMapToFrame) window.fitMapToFrame(true);
    }, 450);
};

// ─── Layer Groups ─────────────────────────────────────────────────────────────
const layerGroups = {
    'Industrial Fire':                      L.layerGroup(),
    'Persistent Industrial Thermal Source': L.layerGroup(),
    'Agricultural Burn':                    L.layerGroup(),
    'Forest Fire':                          L.layerGroup()
};

for (const key in layerGroups) {
    layerGroups[key].addTo(map);
}

const overlayMaps = {
    "🔴 Industrial Fire":         layerGroups['Industrial Fire'],
    "🔥 Forest Fire":             layerGroups['Forest Fire'],
    "🌾 Agricultural Burn":       layerGroups['Agricultural Burn'],
    "🟢 Persistent Industrial Thermal Source": layerGroups['Persistent Industrial Thermal Source']
};

L.control.layers(null, overlayMaps, { collapsed: true, position: 'bottomleft' }).addTo(map);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Colour lookup for each fire class */
const CLASS_COLOURS = {
    'Industrial Fire':            '#ef4444',
    'Persistent Industrial Thermal Source': '#10b981',
    'Agricultural Burn':          '#facc15',
    'Forest Fire':                '#f97316',
};

function mapCategory(originalCls) {
    if (!originalCls) return null;
    const c = originalCls.toLowerCase();
    if (c.includes('persistent') || c.includes('flare') || c.includes('routine')) return 'Persistent Industrial Thermal Source';
    if (c.includes('industrial')) return 'Industrial Fire';
    if (c.includes('agri')) return 'Agricultural Burn';
    if (c.includes('wildfire') || c.includes('forest')) return 'Forest Fire';
    return originalCls;
}

/** Risk level → badge colour */
function riskColour(riskLevel) {
    if (!riskLevel) return '#64748b';
    const r = riskLevel.toLowerCase();
    if (r.includes('extreme'))   return '#dc2626';
    if (r.includes('critical'))  return '#f97316';
    if (r.includes('moderate'))  return '#eab308';
    return '#22c55e';
}

/** Confidence score → visual bar HTML */
function confidenceBar(conf) {
    const pct = parseFloat(conf) || 0;
    const colour = pct >= 85 ? '#10b981' : pct >= 65 ? '#eab308' : '#ef4444';
    return `
        <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
            <div style="flex:1; background:rgba(255,255,255,0.1); border-radius:3px; height:6px; overflow:hidden;">
                <div style="width:${pct}%; background:${colour}; height:100%; border-radius:3px;
                            transition: width 0.5s ease;"></div>
            </div>
            <span style="font-size:0.75rem; font-weight:600; color:${colour};">${pct.toFixed(1)}%</span>
        </div>`;
}

/** Format acquisition time string */
function formatAcqTime(timeStr) {
    const t = String(timeStr).padStart(4, '0');
    return `${t.slice(0, 2)}:${t.slice(2)} UTC`;
}

// ─── Popup Open Event Interception ──────────────────────────────────────────
map.on('popupopen', function(e) {
    const popupContent = e.popup.getElement();
    if (!popupContent) return;
    
    // Prevent any clicks or scroll events inside the popup from bubbling to the map
    L.DomEvent.disableClickPropagation(popupContent);
    L.DomEvent.disableScrollPropagation(popupContent);
    
    // Native DOM event interception for all pointer/mouse/touch events
    ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach(evtType => {
        popupContent.addEventListener(evtType, function(ev) {
            ev.stopPropagation();
            if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
        }, { passive: false });
    });
});

/** Count up animation */
function animateValue(id, start, end, duration) {
    const obj = document.getElementById(id);
    if (!obj) return;
    if (start === end) { obj.innerHTML = end; return; }
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

/** Build clean, intuitive popup HTML: Location, Intensity, Impact + Expandable Info Palette */
function buildPopupHTML(feature) {
    const p = feature.properties;
    const cls = p.ai_classification || 'Unknown';
    const colour = CLASS_COLOURS[cls] || '#f59e0b';
    const conf = parseFloat(p.ai_confidence) || 0;
    const risk = p.risk_level || 'Active Fire Hazard';
    const frp = parseFloat(p.frp || 0).toFixed(1);
    const frpNum = parseFloat(p.frp || 0);
    const brightness = parseFloat(
        p.brightness || p.bright_ti4 || p.bright_ti5 || 315
    ).toFixed(1);
    const tempC = (parseFloat(brightness) - 273.15).toFixed(0);
    const temp = parseFloat(p.temperature || 0).toFixed(1);
    const wind = parseFloat(p.wind_speed || 0).toFixed(1);
    const windDir = parseFloat(p.wind_direction || 0).toFixed(0);
    const aqi = parseFloat(p.aqi || 0).toFixed(0);
    const aqiColour = parseFloat(aqi) > 150 ? '#ef4444' : parseFloat(aqi) > 100 ? '#f97316' : '#10b981';
    const persistence = parseFloat(p.persistence || 0);
    const persistBar = Math.round(persistence * 100);
    const impactRadius = Math.max(frpNum * 0.012, 0.25).toFixed(2);
    const spreadSpeed = parseFloat(p.spread_speed_kmh || 0).toFixed(1);
    const lat = parseFloat(p.latitude).toFixed(3);
    const lon = parseFloat(p.longitude).toFixed(3);

    // Intensity Rating Badge
    let intensityLabel = 'Moderate';
    let intensityCol = '#facc15';
    let intensityBg = 'rgba(250, 204, 21, 0.2)';
    if (frpNum >= 80) {
        intensityLabel = 'Severe Inferno';
        intensityCol = '#ef4444';
        intensityBg = 'rgba(239, 68, 68, 0.25)';
    } else if (frpNum >= 45) {
        intensityLabel = 'High Intensity';
        intensityCol = '#f97316';
        intensityBg = 'rgba(249, 115, 22, 0.25)';
    } else if (frpNum >= 25) {
        intensityLabel = 'Heavy Flame';
        intensityCol = '#fbbf24';
        intensityBg = 'rgba(251, 191, 36, 0.2)';
    }

    // Terrain & Icons
    const terrain = p.satellite_terrain || 'Unknown';
    let terrainIcon = '🛰️';
    let terrainCol = '#38bdf8';
    let fireIcon = '🔥';
    if (cls === 'Industrial Fire') {
        fireIcon = '🔴';
        terrainIcon = '🏭';
        terrainCol = '#f87171';
    } else if (cls === 'Forest Fire') {
        fireIcon = '🔥';
        terrainIcon = '🌲';
        terrainCol = '#34d399';
    } else if (cls === 'Agricultural Burn') {
        fireIcon = '🌾';
        terrainIcon = '🌾';
        terrainCol = '#fde047';
    } else if (cls.includes('Persistent')) {
        fireIcon = '🟢';
        terrainIcon = '⚓';
        terrainCol = '#38bdf8';
    }

    return `
        <div class="spot-popup-card">
            <!-- Header: Category & AI Verdict -->
            <div class="popup-header">
                <div class="popup-title-group">
                    <span class="fire-badge" style="background: ${colour}22; color: ${colour}; border: 1px solid ${colour}55;">
                        ${fireIcon} ${cls}
                    </span>
                    <span class="conf-pill">${conf.toFixed(0)}% AI Confirmed</span>
                </div>
            </div>

            <!-- 1. 📍 LOCATION (Instant 0ms Display) -->
            <div class="popup-section">
                <div class="section-label">📍 Fire Location</div>
                <div class="address-text">${p.location_name || `${lat}°N, ${lon}°E`}</div>
                <div class="coords-subtext">${lat}°N, ${lon}°E</div>
            </div>

            <!-- 2. ⚡ INTENSITY -->
            <div class="popup-section">
                <div class="section-header-row">
                    <span class="section-label">⚡ Fire Intensity</span>
                    <span class="intensity-rating-pill" style="background: ${intensityBg}; color: ${intensityCol};">
                        ${intensityLabel}
                    </span>
                </div>
                <div class="intensity-metrics-row">
                    <div class="metric-block">
                        <span class="metric-val" style="color: ${intensityCol};">${frp} <small style="font-size:0.65rem;">MW</small></span>
                        <span class="metric-lbl">Radiative Power</span>
                    </div>
                    <div class="metric-divider"></div>
                    <div class="metric-block">
                        <span class="metric-val">${tempC}°C</span>
                        <span class="metric-lbl">Peak Temp (${brightness} K)</span>
                    </div>
                </div>
            </div>

            <!-- 3. 💥 IMPACT -->
            <div class="popup-section">
                <div class="section-label">💥 Projected Impact & Threat</div>
                <div class="impact-row">
                    <div class="impact-item">
                        <span class="impact-icon">🎯</span>
                        <div>
                            <div class="impact-val">${impactRadius} km</div>
                            <div class="impact-sub">Hazard Radius</div>
                        </div>
                    </div>
                    <div class="impact-item">
                        <span class="impact-icon">💨</span>
                        <div>
                            <div class="impact-val">${spreadSpeed} km/h</div>
                            <div class="impact-sub">Spread Rate</div>
                        </div>
                    </div>
                </div>
                <div class="threat-summary" style="border-left: 3px solid ${riskColour(risk)};">
                    <strong>${risk}</strong> — ${p.mitigation_strategy || 'Active tactical monitoring'}
                </div>
            </div>

            <!-- 4. ℹ️ MORE INFO BUTTON -->
            <button class="more-info-toggle-btn" 
                    onmousedown="if(event.stopPropagation)event.stopPropagation();" 
                    onpointerdown="if(event.stopPropagation)event.stopPropagation();" 
                    onclick="window.toggleHotspotPalette(this, event)">
                <span class="btn-text">ℹ️ More Info & Satellite Telemetry</span>
                <span class="chevron">▼</span>
            </button>

            <!-- 5. 🛰️ COLLAPSIBLE INFO PALETTE -->
            <div class="expanded-info-palette" style="display: none;">
                <!-- Optical Satellite Imagery & Vision Telemetry -->
                <div class="palette-subcard">
                    <div class="palette-subcard-title">
                        <span>🛰️ Satellite Optical Imagery</span>
                        <span style="color: ${terrainCol};">${terrainIcon} ${terrain}</span>
                    </div>
                    ${p.tile_url ? `
                    <div class="snapshot-img-box">
                        <img src="${p.tile_url}" alt="Optical Tile" class="snapshot-img" onerror="this.parentElement.style.display='none'" />
                        <div class="snapshot-overlay">
                            <span>High-Res Optical Snapshot</span>
                            <span>ESRI 30cm</span>
                        </div>
                    </div>
                    ` : ''}
                    <div class="vision-telemetry-row">
                        <span>🌿 Vegetation: <strong>${parseFloat(p.vision_greenery || 0).toFixed(1)}%</strong></span>
                        <span>📐 Structures: <strong>${parseFloat(p.vision_structure || 0).toFixed(2)}</strong></span>
                    </div>
                    <div class="map-verification-status">
                        ${cls === 'Industrial Fire' 
                            ? '<span style="color:#f87171; font-weight:600;">🏭 Industrial Complex Confirmed on Map</span>' 
                            : '<span style="color:#34d399; font-weight:600;">🌲 Wildland / Forest Fire (No Industry on Map)</span>'}
                    </div>
                </div>

                <!-- Weather Telemetry -->
                <div class="palette-subcard">
                    <div class="palette-subcard-title">🌤️ Meteorological Conditions</div>
                    <div class="weather-telemetry-grid">
                        <div>Wind: <strong>${wind} km/h (${windDir}°)</strong></div>
                        <div>Humidity: <strong>${parseFloat(p.humidity || 0).toFixed(0)}%</strong></div>
                        <div>AQI: <strong style="color:${aqiColour};">${aqi}</strong></div>
                        <div>30d Recurrence: <strong>${persistBar}%</strong></div>
                    </div>
                </div>

                <!-- Satellite Sensor Metadata -->
                <div class="palette-subcard">
                    <div class="metadata-row">
                        <span>Sensor: ${p.satellite || 'VIIRS'}</span>
                        <span>Acq: ${p.acq_date} · ${formatAcqTime(p.acq_time)}</span>
                    </div>
                </div>

                <!-- Action Protocol Button -->
                ${(cls === 'Industrial Fire' || cls === 'Forest Fire' || cls.includes('Persistent')) ? `
                <div style="margin-top: 6px;">
                    <button onclick="window.toggleEvacPlan(this, ${p.latitude}, ${p.longitude}, ${frpNum}, '${cls}')" 
                            style="
                                width: 100%;
                                background: ${cls === 'Industrial Fire' ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'};
                                color: ${cls === 'Industrial Fire' ? '#fca5a5' : '#6ee7b7'};
                                border: 1px solid ${cls === 'Industrial Fire' ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.4)'};
                                padding: 6px 10px;
                                border-radius: 6px;
                                font-family: 'Outfit', sans-serif;
                                font-weight: 600;
                                cursor: pointer;
                                font-size: 0.72rem;
                            ">
                        🚨 View Tactical Evacuation Protocol
                    </button>
                    <div style="display:none; background:rgba(0,0,0,0.3); padding:6px 8px; border-radius:4px; margin-top:4px; font-size:0.7rem; color:#cbd5e1;">
                        <ul style="margin:0; padding-left:14px; line-height:1.4;">
                            ${cls === 'Industrial Fire' ? `
                                <li>Establish minimum containment exclusion zone</li>
                                <li>Dispatch specialized industrial foam firefighting unit</li>
                                <li>Trigger emergency automated facility shutdown</li>
                            ` : `
                                <li>Establish firebreak perimeter downwind</li>
                                <li>Request aerial retardant suppression support</li>
                                <li>Issue evacuation warning for downwind settlements</li>
                            `}
                        </ul>
                    </div>
                </div>
                ` : ''}

                <!-- Dedicated Close Details Button at Bottom -->
                <button class="close-palette-btn" 
                        onmousedown="if(event.stopPropagation)event.stopPropagation();" 
                        onpointerdown="if(event.stopPropagation)event.stopPropagation();" 
                        onclick="window.closeHotspotPalette(this, event)">
                    <span>✖ Close Details Palette</span>
                </button>
            </div>
        </div>`;
}

window.toggleHotspotPalette = function(btn, event) {
    if (event) {
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        if (event.preventDefault) event.preventDefault();
    }
    if (window.L && L.DomEvent && event) {
        L.DomEvent.stopPropagation(event);
    }
    const card = btn.closest('.spot-popup-card');
    if (!card) return;
    const palette = card.querySelector('.expanded-info-palette');
    if (!palette) return;
    const isHidden = (palette.style.display === 'none' || !palette.style.display);
    palette.style.display = isHidden ? 'block' : 'none';
    
    if (isHidden) {
        btn.classList.add('active-open');
    } else {
        btn.classList.remove('active-open');
    }
    
    const chevron = btn.querySelector('.chevron');
    const textEl = btn.querySelector('.btn-text');
    if (chevron) chevron.innerText = isHidden ? '▲' : '▼';
    if (textEl) textEl.innerText = isHidden ? '✖ Close Details Palette' : 'ℹ️ More Info & Satellite Telemetry';
};

window.closeHotspotPalette = function(btn, event) {
    if (event) {
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        if (event.preventDefault) event.preventDefault();
    }
    const card = btn.closest('.spot-popup-card');
    if (!card) return;
    const palette = card.querySelector('.expanded-info-palette');
    const toggleBtn = card.querySelector('.more-info-toggle-btn');
    if (palette) palette.style.display = 'none';
    if (toggleBtn) {
        toggleBtn.classList.remove('active-open');
        const chevron = toggleBtn.querySelector('.chevron');
        const textEl = toggleBtn.querySelector('.btn-text');
        if (chevron) chevron.innerText = '▼';
        if (textEl) textEl.innerText = 'ℹ️ More Info & Satellite Telemetry';
    }
};

// ─── Main Data Loader ─────────────────────────────────────────────────────────

function clearHotspotLayers() {
    layerGroups['Industrial Fire'].clearLayers();
    layerGroups['Persistent Industrial Thermal Source'].clearLayers();
    layerGroups['Agricultural Burn'].clearLayers();
    layerGroups['Forest Fire'].clearLayers();
    window.hotspotDualLayers = [];
}

let analyticsChart = null;
function updateAnalyticsChart(counts) {
    const ctx = document.getElementById('analyticsChart');
    if (!ctx) return;
    
    const data = [counts.industrial, counts.persistent, counts.agri, counts.forest];
    if (data.every(v => v === 0)) return; // Wait for data
    
    if (analyticsChart) {
        analyticsChart.data.datasets[0].data = data;
        analyticsChart.update();
    } else {
        analyticsChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Industrial Fire', 'Persistent Source', 'Agri Burn', 'Forest Fire'],
                datasets: [{
                    data: data,
                    backgroundColor: ['#ef4444', '#10b981', '#facc15', '#f97316'],
                    borderWidth: 0,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15,15,20,0.9)',
                        titleFont: { family: 'Outfit', size: 13 },
                        bodyFont: { family: 'Outfit', size: 13 },
                        padding: 10,
                        cornerRadius: 8,
                        displayColors: true
                    }
                },
                layout: { padding: 10 }
            }
        });
    }
}

function loadData() {
    const syncEl = document.getElementById('last-sync-time');
    if (syncEl) syncEl.innerText = new Date().toLocaleTimeString();

    // Track all counters in one object
    let counts = {
        total: 0, industrial: 0, persistent: 0, agri: 0, forest: 0
    };

    // ── 1. Land Zones ─────────────────────────────────────────────────────
    
    // Helper to load a zone layer
    const loadZone = (type, groupName, color) => {
        fetch(`/api/zones/${type}`)
            .then(r => r.json())
            .then(data => {
                if (!data.error) {
                    layerGroups[groupName].clearLayers();
                    L.geoJSON(data, {
                        style: {
                            color: color,
                            weight: 0,
                            fillOpacity: 0.15
                        },
                        onEachFeature: function(feature, layer) {
                            const p = feature.properties || {};
                            const ftype = p.facility_type || p.subtype || p.zone_label || 'Zone';
                            layer.bindTooltip(
                                `<strong style="color:${color};">${p.name || 'Unnamed Area'}</strong><br>
                                 <span style="font-size:0.75rem;">${ftype}</span>`,
                                { sticky: true }
                            );
                        }
                    }).addTo(layerGroups[groupName]);
                }
            })
            .catch(() => {});
    };

    // Auxiliary map layers (Zones, Spread Predictions, Mitigations) have been removed per user request.

    // ── 4. Hotspot Points ─────────────────────────────────────────────────
    fetch('/api/hotspots')
        .then(r => r.json())
        .then(data => {
            if (data.error) return;
            
            // Capture currently open popup coordinates to smoothly restore it after layer swap
            let openPopupCoords = null;
            if (map && map._popup && map.hasLayer(map._popup)) {
                openPopupCoords = map._popup.getLatLng();
            }

            // Clear only hotspot layers here (after data arrives — prevents flicker)
            clearHotspotLayers();

            const popupConfig = {
                maxWidth: 340,
                minWidth: 280,
                closeOnClick: false,    // Keeps details palette open when clicking or dragging the map!
                autoClose: false,       // NEVER closes automatically - stays open till user closes it!
                closeButton: true,      // User explicitly closes via 'X' or 'Close Details Palette'
                autoPan: false          // Prevents abrupt autoPan jumps from interfering with open popup!
            };

            L.geoJSON(data, {
                style: function(feature) {
                    const originalCls = feature.properties.ai_classification;
                    const mappedCls = mapCategory(originalCls);
                    if (!mappedCls) return { weight: 0, fillOpacity: 0, opacity: 0 }; // Hide dropped
                    
                    const cls = mappedCls;
                    feature.properties.ai_classification = cls; // Update it on the fly for popup
                    
                    const colour = CLASS_COLOURS[cls] || '#f59e0b';
                    const isCritical = cls === 'Industrial Fire';
                    
                    return {
                        stroke: false,
                        weight: 0,
                        color: 'transparent',
                        fillColor: colour,
                        fillOpacity: isCritical ? 0.65 : 0.4
                    };
                },
                onEachFeature: function(feature, layer) {
                    const cls = feature.properties.ai_classification;
                    if (!CLASS_COLOURS[cls]) return; // Dropped feature
                    
                    counts.total++;

                    // Accumulate stats
                    if (cls === 'Industrial Fire') counts.industrial++;
                    else if (cls === 'Persistent Industrial Thermal Source') counts.persistent++;
                    else if (cls === 'Agricultural Burn') counts.agri++;
                    else if (cls === 'Forest Fire') counts.forest++;

                    const isCritical = cls === 'Industrial Fire';
                    const pixelRadius = isCritical ? 10 : 7;
                    const colour = CLASS_COLOURS[cls] || '#f59e0b';
                    
                    const center = layer.getBounds ? layer.getBounds().getCenter() : layer.getLatLng ? layer.getLatLng() : [feature.properties.latitude, feature.properties.longitude];
                    const circle = L.circleMarker(center, {
                        radius: pixelRadius,
                        stroke: false,
                        weight: 0,
                        color: 'transparent',
                        fillColor: colour,
                        opacity: 0,
                        fillOpacity: isCritical ? 0.9 : 0.7,
                    });

                    circle.bindPopup(buildPopupHTML(feature), popupConfig);

                    if (layerGroups[cls]) {
                        layerGroups[cls].addLayer(circle);
                    }
                }
            });

            // Apply zoom logic to newly loaded data
            if (window.updateHotspotVisibility) {
                window.updateHotspotVisibility();
            }

            // Restore the open popup if there was one
            if (openPopupCoords) {
                let matchedLayer = null;
                let minDist = Infinity;
                window.hotspotDualLayers.forEach(dl => {
                    if (dl._circle) {
                        let ll = dl._circle.getLatLng();
                        let dist = openPopupCoords.distanceTo(ll);
                        if (dist < minDist && dist < 50) { // within 50 meters
                            minDist = dist;
                            matchedLayer = dl._circle;
                        }
                    }
                });
                if (matchedLayer) {
                    matchedLayer.openPopup();
                }
            }

            // Update stat counters with animation (smooth transition from previous counts)
            const prevCounts = window.currentCounts || { total: 0, industrial: 0, persistent: 0, agri: 0, forest: 0 };
            animateValue('total-hotspots', prevCounts.total, counts.total, 800);
            if (document.getElementById('industrial-fire-count')) animateValue('industrial-fire-count', prevCounts.industrial, counts.industrial, 800);
            if (document.getElementById('persistent-count')) animateValue('persistent-count', prevCounts.persistent, counts.persistent, 800);
            if (document.getElementById('agri-count')) animateValue('agri-count', prevCounts.agri, counts.agri, 800);
            if (document.getElementById('forest-fire-count')) animateValue('forest-fire-count', prevCounts.forest, counts.forest, 800);
            window.currentCounts = counts;

            // Trigger Siren Popup only when NEW critical fires appear after initial scan
            const currentCriticalCount = counts.industrial + counts.forest;
            if (window.lastCriticalCount === undefined) {
                window.lastCriticalCount = currentCriticalCount;
            } else if (currentCriticalCount > window.lastCriticalCount) {
                const sirenPopup = document.getElementById('initial-fire-popup');
                if (sirenPopup) {
                    sirenPopup.style.display = 'flex';
                    const textEl = document.getElementById('initial-fire-popup-text');
                    if (textEl) {
                        textEl.innerHTML = `<strong>🚨 SIREN ALERT:</strong> ${currentCriticalCount - window.lastCriticalCount} NEW critical hazard(s) detected since last scan! Immediate attention required.`;
                    }
                }
                window.lastCriticalCount = currentCriticalCount;
            }

            // Update critical alert banner
            const alertEl = document.getElementById('critical-alert');
            if (alertEl) {
                alertEl.style.display = currentCriticalCount > 0 ? 'flex' : 'none';
                const alertText = document.getElementById('alert-text');
                if (alertText) {
                    alertText.innerText = `⚠️  ${currentCriticalCount} CRITICAL alert${currentCriticalCount > 1 ? 's' : ''} active (Fires/Leaks)`;
                }
            }

            // Populate Live Incident Feed
            const feedContainer = document.getElementById('incident-feed-container');
            if (feedContainer && data.features) {
                feedContainer.innerHTML = ''; // Clear awaiting message
                let feedHTML = '';
                
                // Sort features by FRP (highest first) to show most critical incidents
                const sortedFeatures = data.features
                    .filter(f => f.properties.ai_classification === 'Industrial Fire' || f.properties.ai_classification === 'Forest Fire')
                    .sort((a, b) => (parseFloat(b.properties.frp) || 0) - (parseFloat(a.properties.frp) || 0))
                    .slice(0, 30); // Show top 30 critical alerts
                
                if (sortedFeatures.length === 0) {
                    feedContainer.innerHTML = '<div style="color: #94a3b8; font-size: 0.85rem; font-style: italic;">No critical alerts active.</div>';
                } else {
                    sortedFeatures.forEach(feature => {
                        const p = feature.properties;
                        const cls = p.ai_classification || 'Unknown';
                        const colour = CLASS_COLOURS[cls] || '#f59e0b';
                        const frp = parseFloat(p.frp || 0).toFixed(1);
                        const lat = parseFloat(p.latitude).toFixed(3);
                        const lon = parseFloat(p.longitude).toFixed(3);
                        
                        // Relative Comparison Logic
                        let relativeText = "";
                        let baselineFRP = 1.0; // generic baseline
                        
                        if (cls === 'Industrial Fire') {
                            baselineFRP = 3.1; // normal industrial heat
                        } else if (cls === 'Forest Fire' || cls === 'Agricultural Burn') {
                            baselineFRP = 1.5; // normal natural smolder
                        }
                        
                        const percentAboveNormal = Math.round(((parseFloat(frp) - baselineFRP) / baselineFRP) * 100);
                        if (percentAboveNormal > 0) {
                            relativeText = `<span style="color: #ef4444; font-weight:bold; font-size: 0.7rem;">(+${percentAboveNormal}% above normal)</span>`;
                        }
                        
                        const terrain = p.satellite_terrain || 'Unknown';
                        let terrainIcon = '🛰️';
                        let terrainCol = '#38bdf8';
                        let terrainBg = 'rgba(56, 189, 248, 0.15)';
                        if (terrain.includes('Industry')) {
                            terrainIcon = '🏭';
                            terrainCol = '#f87171';
                            terrainBg = 'rgba(239, 68, 68, 0.2)';
                        } else if (terrain.includes('Forest')) {
                            terrainIcon = '🌲';
                            terrainCol = '#34d399';
                            terrainBg = 'rgba(16, 185, 129, 0.2)';
                        } else if (terrain.includes('Agricultural')) {
                            terrainIcon = '🌾';
                            terrainCol = '#fde047';
                            terrainBg = 'rgba(250, 204, 21, 0.2)';
                        } else if (terrain.includes('Water')) {
                            terrainIcon = '⚓';
                            terrainCol = '#38bdf8';
                            terrainBg = 'rgba(14, 165, 233, 0.2)';
                        }
                        
                        feedHTML += `
                        <div class="feed-item" onclick="flyToIncident(${p.latitude}, ${p.longitude})">
                            <div class="feed-title" style="color: ${colour}; display: flex; justify-content: space-between; align-items: center;">
                                <span>${cls}</span>
                                <span style="font-size: 0.68rem; padding: 1px 6px; border-radius: 4px; font-weight: 600; background: ${terrainBg}; color: ${terrainCol};">${terrainIcon} ${terrain.replace('Agricultural Farmland', 'Farmland')}</span>
                            </div>
                            <div class="feed-meta" style="margin-top: 4px; display: flex; justify-content: space-between;">
                                <span>FRP: ${frp} MW ${relativeText}</span>
                                <span>${lat}N, ${lon}E</span>
                            </div>
                        </div>`;
                    });
                    feedContainer.innerHTML = feedHTML;
                }
            }

            // Update Chart.js donut
            updateAnalyticsChart(counts);

            // Update live satellite acquisition time and sync status
            updateAcquisitionTime(data.features);
            fetchSyncStatus();
        })
        .catch(err => console.error('Error loading hotspots:', err));
        // NOTE: Unconditional 60-second reloads have been removed.
        // Dashboard strictly only refreshes when new satellite data is actually available!
}

// ─── NASA Satellite Sync & Change-Driven Update Engine ────────────────────────
// Strictly only updates when new satellite passes arrive or when user requests manual sync.
window.syncCountdownSeconds = 600; // 10-minute countdown (NASA EOSDIS VIIRS cycle)
window.latestSatelliteAcqStr = "Connecting...";
window.totalFiresSynced = 0;
window.lastLoadedDataVersion = null;
window.isCheckingUpdates = false;

// Notification toast when new satellite data is synced
function showDataUpdateToast(info) {
    let toast = document.getElementById('data-update-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'data-update-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 32px;
            right: 32px;
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid rgba(56, 189, 248, 0.6);
            backdrop-filter: blur(12px);
            color: #f8fafc;
            padding: 12px 20px;
            border-radius: 12px;
            font-family: 'Outfit', sans-serif;
            font-size: 0.88rem;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5), 0 0 20px rgba(56,189,248,0.25);
            z-index: 99999;
            opacity: 0;
            transform: translateY(20px);
            transition: opacity 0.3s ease, transform 0.3s ease;
            pointer-events: none;
        `;
        document.body.appendChild(toast);
    }
    const count = (info && info.total_fires) ? info.total_fires.toLocaleString() : (window.totalFiresSynced ? window.totalFiresSynced.toLocaleString() : 'Active');
    const acq = (info && info.latest_satellite_acq) || window.latestSatelliteAcqStr || 'Latest Pass';
    toast.innerHTML = `
        <span style="font-size: 1.3rem;">🛰️</span>
        <div>
            <div style="font-weight: 600; color: #38bdf8;">New Satellite Pass Synced</div>
            <div style="font-size: 0.76rem; color: #94a3b8;">Dashboard updated · ${count} hotspots · ${acq}</div>
        </div>
    `;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
    }, 5000);
}

// Check for updates: ONLY refreshes the page/dashboard when new data is detected
function checkAndRefreshIfChanged(forceRefresh = false) {
    if (window.isCheckingUpdates) return Promise.resolve(false);
    window.isCheckingUpdates = true;

    return fetch('/api/data/version')
        .then(r => r.json())
        .then(info => {
            window.isCheckingUpdates = false;
            if (!info || !info.version) return false;

            if (info.next_sync_seconds !== undefined) {
                window.syncCountdownSeconds = info.next_sync_seconds;
            }
            if (info.latest_satellite_acq) {
                window.latestSatelliteAcqStr = info.latest_satellite_acq;
            }
            if (info.total_fires) {
                window.totalFiresSynced = info.total_fires;
            }
            renderSyncInfo(info);

            const isInitial = (window.lastLoadedDataVersion === null);
            const hasNewData = (!isInitial && info.version !== window.lastLoadedDataVersion);

            if (isInitial || forceRefresh) {
                window.lastLoadedDataVersion = info.version;
                loadData();
                return true;
            } else if (hasNewData) {
                console.log(`[Data Sync] New satellite data available! Updating dashboard (${window.lastLoadedDataVersion} -> ${info.version})`);
                window.lastLoadedDataVersion = info.version;
                
                // Refresh dashboard components with the new data
                loadData();
                loadFireHistoryChart();
                loadActiveFireZones();
                fetchSyncStatus();
                showDataUpdateToast(info);
                return true;
            } else {
                // No new data available! Strictly DO NOT refresh or wipe anything!
                console.log('[Data Sync] No new changes detected. Keeping map stable.');
                return false;
            }
        })
        .catch(err => {
            window.isCheckingUpdates = false;
            console.warn('[Data Version Check] Warning:', err);
            return false;
        });
}

function fetchSyncStatus() {
    fetch('/api/sync/status')
        .then(r => r.json())
        .then(info => {
            if (info) {
                if (info.latest_satellite_acq) {
                    window.latestSatelliteAcqStr = info.latest_satellite_acq;
                }
                if (info.total_fires_active) {
                    window.totalFiresSynced = info.total_fires_active;
                }
                renderSyncInfo(info);
            }
        })
        .catch(() => {});
}

function renderSyncInfo(info) {
    const timeEl = document.getElementById('current-time');
    const syncEl = document.getElementById('last-sync-time');
    
    const mins = Math.floor(window.syncCountdownSeconds / 60);
    const secs = window.syncCountdownSeconds % 60;
    const countdownStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    if (timeEl) {
        const satAcq = window.latestSatelliteAcqStr;
        timeEl.innerHTML = `🛰️ NASA VIIRS: <strong style="color:#38bdf8;">${satAcq}</strong> <span style="margin: 0 4px; opacity:0.5;">·</span> Next Check: <strong style="color:#facc15;" id="sync-countdown-val">${countdownStr}</strong>`;
    }
    
    if (syncEl) {
        const count = (info && info.total_fires_active) ? info.total_fires_active.toLocaleString() : (window.totalFiresSynced ? window.totalFiresSynced.toLocaleString() : 'Connecting...');
        syncEl.innerHTML = `<span style="color:#10b981;">● Synced (${count} Hotspots)</span> <span style="color:#94a3b8; font-size:0.7rem;">· Every 10m (NASA EOSDIS)</span>`;
    }
}

// 1-second dynamic countdown ticker (pure timer: zero network requests during countdown)
if (!window.syncTimerInterval) {
    window.syncTimerInterval = setInterval(() => {
        if (window.syncCountdownSeconds > 0) {
            window.syncCountdownSeconds--;
            const countSpan = document.getElementById('sync-countdown-val');
            if (countSpan) {
                const mins = Math.floor(window.syncCountdownSeconds / 60);
                const secs = window.syncCountdownSeconds % 60;
                countSpan.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            }
        } else {
            // 10 minutes reached: check if new NASA pass has arrived
            // If no new data has arrived, it quietly does NOTHING and resets the timer
            window.syncCountdownSeconds = 600;
            checkAndRefreshIfChanged(false);
        }
    }, 1000);
}

// Manual live sync trigger ("jab jrurat ho tb")
window.triggerLiveSync = function(event) {
    if (event && event.preventDefault) event.preventDefault();
    const btn = document.getElementById('btn-sync-now');
    const spinner = document.getElementById('sync-btn-spinner');
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.add('spin-animation');

    fetch('/api/sync/now?force=true', { method: 'POST' })
        .then(r => r.json())
        .then(res => {
            // Check if backend actually updated data
            fetch('/api/data/version')
                .then(r => r.json())
                .then(info => {
                    const hasNewData = (info && info.version !== window.lastLoadedDataVersion);
                    if (hasNewData) {
                        window.lastLoadedDataVersion = info.version;
                        loadData();
                        loadFireHistoryChart();
                        loadActiveFireZones();
                        fetchSyncStatus();
                        showDataUpdateToast(info);
                        if (btn) btn.innerHTML = `<span style="color:#34d399;">✅ Synced!</span>`;
                    } else {
                        // Data already up to date - no refresh needed
                        fetchSyncStatus();
                        if (btn) btn.innerHTML = `<span style="color:#38bdf8;">✓ Feed Up to Date</span>`;
                    }
                    setTimeout(() => {
                        if (btn) {
                            btn.disabled = false;
                            btn.innerHTML = `<span id="sync-btn-spinner">🔄</span> <span>Sync Feed</span>`;
                        }
                    }, 2500);
                });
        })
        .catch(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span id="sync-btn-spinner">🔄</span> <span>Sync Feed</span>`;
            }
        });
};

// ─── Acquisition Time Sync ───────────────────────────────────────────────────
function updateAcquisitionTime(features) {
    if (!features || !features.length) return;
    
    let latestTimestamp = 0;
    features.forEach(f => {
        if (f.properties && f.properties.acq_date && f.properties.acq_time) {
            const timeStr = String(f.properties.acq_time).padStart(4, '0');
            const dateStr = `${f.properties.acq_date.split('T')[0]}T${timeStr.slice(0,2)}:${timeStr.slice(2)}:00Z`;
            const ts = new Date(dateStr).getTime();
            if (ts > latestTimestamp) latestTimestamp = ts;
        }
    });
    
    if (latestTimestamp > 0) {
        const latestDate = new Date(latestTimestamp);
        const timeFormatted = latestDate.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit',
            timeZone: 'UTC', hour12: false
        });
        const dateFormatted = latestDate.toLocaleDateString('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'
        });
        window.latestSatelliteAcqStr = `${dateFormatted} ${timeFormatted} UTC`;
        renderSyncInfo();
    }
}

// ─── Zoom Rendering Engine ────────────────────────────────────────────────────
window.hotspotDualLayers = [];
window.updateHotspotVisibility = function() {
    // Markers stay persistent across all zoom levels so popups NEVER close on zoom!
};
map.on('zoomend', window.updateHotspotVisibility);

// ─── FlyTo Interactive Feature ───────────────────────────────────────────────
window.flyToIncident = function(lat, lon) {
    map.flyTo([lat, lon], 16, {
        animate: true,
        duration: 1.5
    });
};

// ─── Evacuation Animation ─────────────────────────────────────────────────────
window.activeEvacCircle = null;
window.toggleEvacPlan = function(btn, lat, lon, frp, cls) {
    const el = btn.nextElementSibling;
    const isShowing = el.style.display === 'none';
    el.style.display = isShowing ? 'block' : 'none';
    
    // Clear existing animated circle if any
    if (window.activeEvacCircle) {
        map.removeLayer(window.activeEvacCircle);
        window.activeEvacCircle = null;
    }
    
    // Only draw circle if opening plan for a critical event
    if (isShowing && (cls === 'Accidental Industrial Fire' || cls === 'Urban/Residential Fire' || cls === 'Gas Leakage (Chemical)' || cls === 'Wildfire')) {
        let radiusKm = Math.max(parseFloat(frp) * 0.08, 1.5);
        if (cls === 'Gas Leakage (Chemical)') radiusKm = Math.max(radiusKm, 2.0);
        let radiusMeters = radiusKm * 1000;
        
        window.activeEvacCircle = L.circle([lat, lon], {
            stroke: false,
            weight: 0,
            color: 'transparent',
            fillColor: '#ef4444',
            fillOpacity: 0.2,
            radius: radiusMeters,
            className: 'evac-pulse-circle'
        }).addTo(map);
        
        // Ensure map is zoomed in enough to see the evacuation zone clearly
        if (map.getZoom() < 13) {
            map.flyTo([lat, lon], 13, { animate: true, duration: 1.5 });
        }
    }
};

// ─── Global Fire History Graph (World Map Analysis) ────────────────────────
let fireHistoryChartInstance = null;
function loadFireHistoryChart() {
    fetch('/api/analytics/history')
        .then(r => r.json())
        .then(data => {
            if (!Array.isArray(data) || data.length === 0) return;
            const ctx = document.getElementById('fireHistoryChart');
            if (!ctx) return;

            // Format labels: 'Aug 24', 'Aug 25', ..., 'Sep 05'
            const labels = data.map(d => {
                const parts = d.date.split('-');
                const dt = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            });

            const industrialData = data.map(d => d.industrial);
            const forestData = data.map(d => d.forest);
            const agriData = data.map(d => d.agri);
            const frpData = data.map(d => d.avg_frp);

            // Calculate KPIs
            const totalHotspots = data.reduce((acc, d) => acc + d.total, 0);
            const peakItem = data.reduce((prev, curr) => (curr.total > prev.total ? curr : prev), data[0]);
            const peakIdx = data.indexOf(peakItem);
            const peakDateStr = peakIdx >= 0 ? labels[peakIdx] : '';
            const overallAvgFrp = (data.reduce((acc, d) => acc + (d.avg_frp * d.total), 0) / Math.max(totalHotspots, 1)).toFixed(1);

            const peakEl = document.getElementById('hist-peak-vol');
            if (peakEl) peakEl.innerText = `${peakItem.total} Fires (${peakDateStr})`;
            const avgEl = document.getElementById('hist-avg-frp');
            if (avgEl) avgEl.innerText = `${overallAvgFrp} MW`;
            const totEl = document.getElementById('hist-total-fires');
            if (totEl) totEl.innerText = `${totalHotspots.toLocaleString()} Hotspots`;

            if (fireHistoryChartInstance) {
                fireHistoryChartInstance.data.labels = labels;
                fireHistoryChartInstance.data.datasets[0].data = industrialData;
                fireHistoryChartInstance.data.datasets[1].data = forestData;
                fireHistoryChartInstance.data.datasets[2].data = agriData;
                fireHistoryChartInstance.data.datasets[3].data = frpData;
                fireHistoryChartInstance.update();
                return;
            }

            fireHistoryChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Industrial Fire',
                            data: industrialData,
                            backgroundColor: 'rgba(239, 68, 68, 0.85)',
                            borderRadius: 4,
                            stack: 'fires',
                            order: 2
                        },
                        {
                            label: 'Forest Fire',
                            data: forestData,
                            backgroundColor: 'rgba(249, 115, 22, 0.8)',
                            borderRadius: 4,
                            stack: 'fires',
                            order: 2
                        },
                        {
                            label: 'Agri Burn',
                            data: agriData,
                            backgroundColor: 'rgba(250, 204, 21, 0.75)',
                            borderRadius: 4,
                            stack: 'fires',
                            order: 2
                        },
                        {
                            label: 'Mean FRP (MW)',
                            data: frpData,
                            type: 'line',
                            borderColor: '#38bdf8',
                            backgroundColor: 'rgba(56, 189, 248, 0.1)',
                            borderWidth: 2.5,
                            pointBackgroundColor: '#38bdf8',
                            pointRadius: 3.5,
                            tension: 0.35,
                            yAxisID: 'yFrp',
                            order: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.95)',
                            titleFont: { family: 'Outfit', size: 13, weight: 'bold' },
                            bodyFont: { family: 'Outfit', size: 12 },
                            padding: 10,
                            cornerRadius: 8,
                            borderColor: 'rgba(255, 255, 255, 0.12)',
                            borderWidth: 1
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.04)' },
                            ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } }
                        },
                        y: {
                            stacked: true,
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } },
                            title: { display: true, text: 'Fires Detected', color: '#94a3b8', font: { size: 10, family: 'Outfit' } }
                        },
                        yFrp: {
                            position: 'right',
                            grid: { drawOnChartArea: false },
                            ticks: {
                                color: '#38bdf8',
                                font: { family: 'Outfit', size: 11 },
                                callback: v => v + ' MW'
                            },
                            title: { display: true, text: 'Avg Radiative Power', color: '#38bdf8', font: { size: 10, family: 'Outfit' } }
                        }
                    }
                }
            });
        })
        .catch(err => console.error('Error loading fire history chart:', err));
}

// ─── Most Active Global Fire Zones ──────────────────────────────────────────
window.focusFireZone = function(lat, lon) {
    if (!map) return;
    // If in full map mode and drawer is open, automatically minimize it so the user can view the focused zone!
    const container = document.getElementById('analytics-deck');
    if (container && container.classList.contains('drawer-open')) {
        window.toggleAnalyticsDrawer(false);
    }
    map.flyTo([lat, lon], 5, {
        animate: true,
        duration: 1.5
    });
};

function loadActiveFireZones() {
    fetch('/api/analytics/zones')
        .then(r => r.json())
        .then(zones => {
            const listEl = document.getElementById('active-zones-list');
            if (!listEl) return;
            if (!Array.isArray(zones) || zones.length === 0) {
                listEl.innerHTML = '<div style="color:#94a3b8; font-size:0.8rem; text-align:center; padding:15px;">No active clusters found.</div>';
                return;
            }

            const badge = document.getElementById('active-zones-badge');
            if (badge) badge.innerText = `${zones.length} Monitored Hubs`;

            let html = '';
            zones.forEach(z => {
                const sampleText = z.sample_cities && z.sample_cities.length > 0
                    ? `· ${z.sample_cities.join(', ')}`
                    : '';
                
                let icon = '🔥';
                if (z.industrial_fires > 0) icon = '🏭';
                else if (z.max_frp >= 200) icon = '⚡';

                html += `
                <div class="zone-item-card" onclick="window.focusFireZone(${z.center_lat}, ${z.center_lon})">
                    <div class="zone-info">
                        <div class="zone-name-row">
                            <span style="font-size:1.1rem;">${icon}</span>
                            <div>
                                <div class="zone-name">${z.zone_name}</div>
                                <div class="zone-region">${z.region} ${sampleText}</div>
                            </div>
                        </div>
                        <div class="zone-metrics-row">
                            <span>Total: <strong style="color:#f8fafc;">${z.total_fires}</strong></span>
                            ${z.industrial_fires > 0 ? `<span style="color:#ef4444; font-weight:600;">● ${z.industrial_fires} Industrial</span>` : ''}
                            ${z.forest_fires > 0 ? `<span style="color:#f97316;">● ${z.forest_fires} Forest</span>` : ''}
                            ${z.agri_fires > 0 ? `<span style="color:#facc15;">● ${z.agri_fires} Agri</span>` : ''}
                            <span>Peak: <strong style="color:#38bdf8;">${z.max_frp} MW</strong></span>
                        </div>
                    </div>
                    <button class="zone-focus-btn" onclick="event.stopPropagation(); window.focusFireZone(${z.center_lat}, ${z.center_lon});">
                        <span>🎯 Focus</span>
                    </button>
                </div>`;
            });
            listEl.innerHTML = html;
        })
        .catch(err => console.error('Error loading active fire zones:', err));
}

// ─── Init ─────────────────────────────────────────────────────────────────────
checkAndRefreshIfChanged(true);
loadFireHistoryChart();
loadActiveFireZones();
fetchSyncStatus();

// ─── View Mode Switching & Analytics Drawer ──────────────────────────────────
window.switchViewMode = function(mode) {
    const deck = document.querySelector('.main-content-deck');
    const btnFull = document.getElementById('btn-mode-full');
    const btnSplit = document.getElementById('btn-mode-split');
    const container = document.getElementById('analytics-deck');
    
    if (mode === 'split') {
        if (deck) deck.classList.add('split-mode');
        if (container) container.classList.remove('drawer-open');
        if (btnFull) btnFull.classList.remove('active');
        if (btnSplit) btnSplit.classList.add('active');
    } else {
        if (deck) deck.classList.remove('split-mode');
        if (container) container.classList.remove('drawer-open');
        if (btnFull) btnFull.classList.add('active');
        if (btnSplit) btnSplit.classList.remove('active');
    }
    
    // Invalidate Leaflet map size during transition
    const interval = setInterval(() => map.invalidateSize(), 25);
    setTimeout(() => {
        clearInterval(interval);
        map.invalidateSize();
    }, 450);
};

window.toggleAnalyticsDrawer = function(forceOpen) {
    const container = document.getElementById('analytics-deck');
    const chevron = document.getElementById('dock-chevron-icon');
    if (!container) return;
    
    const isOpen = (typeof forceOpen === 'boolean') 
        ? forceOpen 
        : !container.classList.contains('drawer-open');
        
    if (isOpen) {
        container.classList.add('drawer-open');
        if (chevron) chevron.innerText = '▼';
    } else {
        container.classList.remove('drawer-open');
        if (chevron) chevron.innerText = '▲';
    }
};

window.fitMapToFrame = function(animate = true) {
    if (typeof map === 'undefined' || !map) return;
    map.invalidateSize();
    // Zoom in so that satellite imagery completely covers the entire canvas of the map
    // without ever displaying polar regions or "Map data not available" tiles
    map.setView([20.0, 15.0], 2.9, { animate: animate });
};

window.resetWorldView = function() {
    window.fitMapToFrame(true);
};

// Window resize listener
window.addEventListener('resize', () => {
    if (typeof map !== 'undefined') {
        map.invalidateSize();
    }
});

// Adjust map tiles to full frame size cleanly on start
setTimeout(() => {
    if (typeof map !== 'undefined') {
        map.invalidateSize();
        window.fitMapToFrame(false);
    }
}, 150);
setTimeout(() => {
    if (typeof map !== 'undefined') {
        map.invalidateSize();
    }
}, 500);

// ─── Right Panel Toggle ───────────────────────────────────────────────────────
window.toggleRightPanel = function() {
    const panel = document.getElementById('right-panel');
    const openBtn = document.getElementById('open-panel-btn');
    if (!panel || !openBtn) return;
    
    if (panel.style.display !== 'none') {
        // Hide panel
        panel.style.display = 'none';
        openBtn.style.display = 'block';
    } else {
        // Show panel
        panel.style.display = 'flex';
        openBtn.style.display = 'none';
    }
    
    // Invalidate map size so it fills the newly available space
    setTimeout(() => {
        if (typeof map !== 'undefined') {
            map.invalidateSize();
        }
    }, 50);
};
