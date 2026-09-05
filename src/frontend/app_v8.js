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
    zoomControl: false,
    minZoom: 2, // Allow viewing whole planet
    maxBounds: worldBounds, // Restrict panning to a single Earth
    maxBoundsViscosity: 0.8, // Smooth bounds
    zoomSnap: 1, // Snaps to integer zoom levels to eliminate fractional sub-pixel tile misalignment
    zoomDelta: 1
}).setView([20.0, 0.0], 2);

// Satellite base layer
const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri', noWrap: true }
).addTo(map);

// Dark map overlay for hybrid view (contains the map text/labels)
const darkOverlay = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; CartoDB', opacity: 0.6, noWrap: true }
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
    if (e) e.preventDefault();
    window.isFullScreen = !window.isFullScreen;
    const sidebar = document.querySelector('.sidebar');
    if (window.isFullScreen) {
        sidebar.classList.add('fullscreen-hide');
        document.getElementById('critical-alert').style.left = '50%';
    } else {
        sidebar.classList.remove('fullscreen-hide');
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

// ─── Dynamic Address Fetching for Popups ─────────────────────────────────────
map.on('popupopen', function(e) {
    const popupContent = e.popup.getElement();
    if (!popupContent) return;
    
    const addressSpan = popupContent.querySelector('.address-loader');
    if (addressSpan && !addressSpan.dataset.loaded) {
        addressSpan.dataset.loaded = 'true';
        const lat = addressSpan.getAttribute('data-lat');
        const lon = addressSpan.getAttribute('data-lon');
        
        if (lat && lon) {
            fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
                .then(r => r.json())
                .then(d => {
                    if (d && d.address) {
                        const city = d.address.city || d.address.town || d.address.village || d.address.municipality || d.address.county || d.address.state_district || '';
                        const state = d.address.state || '';
                        const country = d.address.country || d.display_name || '';
                        const fullAddr = [city, state, country].filter(Boolean).join(', ');
                        addressSpan.innerText = fullAddr || d.display_name || `${parseFloat(lat).toFixed(3)}°N, ${parseFloat(lon).toFixed(3)}°E`;
                    } else if (d && d.display_name) {
                        addressSpan.innerText = d.display_name;
                    } else {
                        addressSpan.innerText = `Region (${parseFloat(lat).toFixed(2)}°N, ${parseFloat(lon).toFixed(2)}°E)`;
                    }
                    if (map && map._popup) map._popup.update();
                })
                .catch(err => {
                    addressSpan.innerText = `Wilderness (${parseFloat(lat).toFixed(2)}°N, ${parseFloat(lon).toFixed(2)}°E)`;
                });
        }
    }
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

            <!-- 1. 📍 LOCATION -->
            <div class="popup-section">
                <div class="section-label">📍 Fire Location</div>
                <div class="address-text address-loader" data-lat="${p.latitude}" data-lon="${p.longitude}">
                    Loading location...
                </div>
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
            <button class="more-info-toggle-btn" onclick="window.toggleHotspotPalette(this, event)">
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
                <button class="close-palette-btn" onclick="window.closeHotspotPalette(this, event)">
                    <span>✖ Close Details Palette</span>
                </button>
            </div>
        </div>`;
}

window.toggleHotspotPalette = function(btn, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const palette = btn.nextElementSibling;
    if (!palette) return;
    const isHidden = palette.style.display === 'none';
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
    
    // Auto-refresh Leaflet popup bounds smoothly and pan up slightly so content is visible
    if (map && map._popup) {
        setTimeout(() => {
            map._popup.update();
            if (isHidden) {
                const px = map.project(map._popup.getLatLng());
                px.y -= 60;
                map.panTo(map.unproject(px), { animate: true, duration: 0.25 });
            }
        }, 40);
    }
};

window.closeHotspotPalette = function(btn, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
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
    if (map && map._popup) {
        setTimeout(() => map._popup.update(), 30);
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
            
            // If user currently has an open popup on the map (e.g. reading details),
            // do NOT wipe the map layers so the details palette stays open and stable!
            const isUserInspecting = (map && map._popup && map.hasLayer(map._popup));
            if (isUserInspecting) {
                // Update stats and incident feed, but don't disrupt the active inspection popup
                updateAnalyticsChart(counts);
                return;
            }

            // Capture currently open popup to restore it after refresh
            let openPopupCoords = null;
            if (map && map._popup && map.hasLayer(map._popup)) {
                openPopupCoords = map._popup.getLatLng();
            }

            // Clear only hotspot layers here (after data arrives — prevents flicker)
            clearHotspotLayers();

            const popupConfig = {
                maxWidth: 330,
                minWidth: 280,
                closeOnClick: false,    // Keeps details palette open when clicking or dragging the map!
                autoClose: true,        // Switches cleanly if user clicks a different fire spot
                closeButton: true,      // User explicitly closes via 'X' or 'Close Details Palette'
                autoPan: true,
                autoPanPadding: [25, 25]
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

                    layer.bindPopup(buildPopupHTML(feature), popupConfig);
                    circle.bindPopup(buildPopupHTML(feature), popupConfig);

                    const dualLayer = L.featureGroup();
                    dualLayer._polygon = layer;
                    dualLayer._circle = circle;
                    
                    window.hotspotDualLayers.push(dualLayer);

                    if (layerGroups[cls]) {
                        layerGroups[cls].addLayer(dualLayer);
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

            // Update stat counters with animation
            animateValue('total-hotspots', 0, counts.total,     1200);
            if (document.getElementById('industrial-fire-count')) animateValue('industrial-fire-count', 0, counts.industrial, 1200);
            if (document.getElementById('persistent-count')) animateValue('persistent-count', 0, counts.persistent, 1200);
            if (document.getElementById('agri-count')) animateValue('agri-count', 0, counts.agri, 1200);
            if (document.getElementById('forest-fire-count')) animateValue('forest-fire-count', 0, counts.forest, 1200);

            // Trigger Siren Popup whenever a NEW critical fire appears
            const currentCriticalCount = counts.industrial + counts.forest;
            if (window.lastCriticalCount === undefined) {
                window.lastCriticalCount = 0;
            }
            
            if (currentCriticalCount > window.lastCriticalCount) {
                const sirenPopup = document.getElementById('initial-fire-popup');
                if (sirenPopup) {
                    sirenPopup.style.display = 'flex';
                    const textEl = document.getElementById('initial-fire-popup-text');
                    if (textEl) {
                        textEl.innerHTML = `<strong>🚨 SIREN ALERT:</strong> ${currentCriticalCount - window.lastCriticalCount} NEW critical hazard(s) detected since last scan! Immediate attention required.`;
                    }
                }
            }
            window.lastCriticalCount = currentCriticalCount;

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
        })
        .catch(err => console.error('Error loading hotspots:', err))
        .finally(() => {
            setTimeout(loadData, 60000); // Recursive call ensures no overlap
        });
}

// ─── Acquisition Time Sync ───────────────────────────────────────────────────
function updateAcquisitionTime(features) {
    const el = document.getElementById('current-time');
    if (!el || !features || !features.length) return;
    
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
            month: 'short', day: 'numeric', timeZone: 'UTC'
        });
        el.innerText = `Data Acquired: ${dateFormatted} ${timeFormatted} UTC (Global Realtime)`;
    }
}

// ─── Zoom Rendering Engine ────────────────────────────────────────────────────
window.hotspotDualLayers = [];
window.updateHotspotVisibility = function() {
    const isZoomedIn = map.getZoom() >= 13;
    window.hotspotDualLayers.forEach(dl => {
        if (isZoomedIn) {
            if (dl.hasLayer(dl._circle)) dl.removeLayer(dl._circle);
            if (!dl.hasLayer(dl._polygon)) dl.addLayer(dl._polygon);
        } else {
            if (dl.hasLayer(dl._polygon)) dl.removeLayer(dl._polygon);
            if (!dl.hasLayer(dl._circle)) dl.addLayer(dl._circle);
        }
    });
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

// ─── Init ─────────────────────────────────────────────────────────────────────
loadData();
// Data syncs on loadData

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
