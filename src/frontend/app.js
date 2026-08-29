// ─── Map Initialization ──────────────────────────────────────────────────────
const map = L.map('map', {
    zoomControl: false
}).setView([22.0, 79.0], 5);

// Satellite base layer
const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri' }
).addTo(map);

// Dark map overlay for hybrid view (contains the map text/labels)
const darkOverlay = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; CartoDB', opacity: 0.6 }
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
        sidebar.style.display = 'none';
        document.getElementById('critical-alert').style.left = '50%';
    } else {
        sidebar.style.display = 'flex';
        // Reset to responsive centering logic
        if (window.innerWidth > 992) {
            document.getElementById('critical-alert').style.left = 'calc(360px + (100vw - 360px) / 2)';
        }
    }
    setTimeout(() => map.invalidateSize(), 300);
};

// ─── Layer Groups ─────────────────────────────────────────────────────────────
const layerGroups = {
    'Accidental Industrial Fire':           L.layerGroup(),
    'Industrial Flare':                     L.layerGroup(),
    'Routine Industrial Heat':              L.layerGroup(),
    'Gas Leakage (Chemical)':               L.layerGroup(),
    'Smoke Plume':                          L.layerGroup(),
    'Wildfire':                             L.layerGroup(),
    'Natural Anomaly':                      L.layerGroup(),
    'Predictive Fire Spread (Hazard Zone)': L.layerGroup(),
    'Tactical AI Mitigations':              L.layerGroup(),
    'Industrial Zones':                     L.layerGroup(),
    'Forest / Jungle':                      L.layerGroup(),
    'National Parks / Sanctuaries':         L.layerGroup(),
    'Agricultural / Farmland':              L.layerGroup(),
    'Mining / Quarry Area':                 L.layerGroup(),
};

for (const key in layerGroups) {
    layerGroups[key].addTo(map);
}

const overlayMaps = {
    "🔴 Accidental Fires":         layerGroups['Accidental Industrial Fire'],
    "🟢 Industrial Flares":        layerGroups['Industrial Flare'],
    "💡 Routine Industrial Heat":  layerGroups['Routine Industrial Heat'],
    "🟣 Gas Leakages":             layerGroups['Gas Leakage (Chemical)'],
    "⚫ Smoke Plumes":             layerGroups['Smoke Plume'],
    "🔥 Wildfires (Forests)":      layerGroups['Wildfire'],
    "🟠 Natural Anomalies":        layerGroups['Natural Anomaly'],
    "🔥 Spread Predictions":       layerGroups['Predictive Fire Spread (Hazard Zone)'],
    "🛡️ Tactical Mitigations":     layerGroups['Tactical AI Mitigations'],
    "<hr style='margin:4px 0'>":   L.layerGroup(), // Separator
    "🏭 Industrial Zones":         layerGroups['Industrial Zones'],
    "🌲 Forest / Jungle":          layerGroups['Forest / Jungle'],
    "🏞️ National Parks":           layerGroups['National Parks / Sanctuaries'],
    "🌾 Agricultural Zones":       layerGroups['Agricultural / Farmland'],
    "⛏️ Mining / Quarries":        layerGroups['Mining / Quarry Area'],
};

L.control.layers(null, overlayMaps, { collapsed: true, position: 'bottomleft' }).addTo(map);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Colour lookup for each fire class */
const CLASS_COLOURS = {
    'Accidental Industrial Fire': '#ef4444',
    'Industrial Flare':           '#10b981',
    'Routine Industrial Heat':    '#84cc16',
    'Gas Leakage (Chemical)':     '#a855f7',
    'Smoke Plume':                '#94a3b8',
    'Wildfire':                   '#f97316',
    'Natural Anomaly':            '#f59e0b',
};

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

/** Build rich popup HTML for a hotspot */
function buildPopupHTML(feature) {
    const p = feature.properties;
    const cls = p.ai_classification || 'Unknown';
    const colour = CLASS_COLOURS[cls] || '#f59e0b';
    const conf = parseFloat(p.ai_confidence) || 0;
    const risk = p.risk_level || 'Unknown';
    const frp = parseFloat(p.frp || 0).toFixed(1);
    const brightness = parseFloat(
        p.brightness || p.bright_ti4 || p.bright_ti5 || 315
    ).toFixed(1);
    const temp = parseFloat(p.temperature || 0).toFixed(1);
    const wind = parseFloat(p.wind_speed || 0).toFixed(1);
    const windDir = parseFloat(p.wind_direction || 0).toFixed(0);
    const aqi = parseFloat(p.aqi || 0).toFixed(0);
    const aqiColour = parseFloat(aqi) > 150 ? '#ef4444' : parseFloat(aqi) > 100 ? '#f97316' : '#10b981';
    const persistence = parseFloat(p.persistence || 0);
    const persistBar = Math.round(persistence * 100);
    const persistColour = persistence > 0.7 ? '#10b981' : persistence > 0.3 ? '#eab308' : '#94a3b8';
    const sources = p.cross_source_count ? parseInt(p.cross_source_count) : 1;
    const sourcesBadge = sources > 1
        ? `<span style="background:#10b981; color:#fff; font-size:0.65rem; padding:1px 5px; border-radius:3px; margin-left:4px;">✓ ${sources} satellites</span>`
        : '';

    return `
        <div style="font-family:'Outfit',sans-serif; min-width:250px; color:#e2e8f0;">
            <div style="border-bottom:1px solid #334155; padding-bottom:8px; margin-bottom:10px;">
                <h3 style="margin:0; color:${colour}; font-size:1.05rem;">${cls}</h3>
                <div style="font-size:0.72rem; color:#94a3b8; margin-top:2px;">
                    AI Confidence ${sourcesBadge}
                </div>
                ${confidenceBar(conf)}
            </div>
            
            ${p.nearest_zone_dist_m !== undefined ? `
            <div style="background:rgba(0,0,0,0.25); border-left:3px solid ${parseFloat(p.nearest_zone_dist_m) <= 1000 ? '#ef4444' : '#eab308'};
                        padding:6px 8px; border-radius:0 4px 4px 0; margin-bottom:10px;">
                <div style="font-size:0.7rem; color:#94a3b8;">Proximity Alert</div>
                <div style="font-weight:600; color:#e2e8f0; font-size:0.8rem;">
                    ${(parseFloat(p.nearest_zone_dist_m) / 1000).toFixed(2)} km from ${p.zone_name || 'Critical Zone'}
                </div>
            </div>
            ` : ''}

            <div style="background:rgba(0,0,0,0.25); border-left:3px solid ${riskColour(risk)};
                        padding:6px 8px; border-radius:0 4px 4px 0; margin-bottom:10px;">
                <div style="font-size:0.7rem; color:#94a3b8;">Tactical AI Assessment</div>
                <div style="font-weight:600; color:${riskColour(risk)}; font-size:0.85rem;">${risk}</div>
                <div style="color:#fbbf24; font-size:0.75rem; margin-top:2px;">⚡ ${p.mitigation_strategy || 'Monitor'}</div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:0.82rem;">
                <div>
                    <div style="color:#64748b; font-size:0.68rem;">Fire Intensity (FRP)</div>
                    <div style="font-weight:600;">${frp} MW</div>
                </div>
                <div>
                    <div style="color:#64748b; font-size:0.68rem;">Brightness Temp</div>
                    <div style="font-weight:600;">${brightness} K (${(parseFloat(brightness) - 273.15).toFixed(1)}°C)</div>
                </div>
                <div>
                    <div style="color:#64748b; font-size:0.68rem;">Spread Speed</div>
                    <div style="font-weight:600;">${parseFloat(p.spread_speed_kmh||0).toFixed(1)} km/h</div>
                </div>
                <div>
                    <div style="color:#64748b; font-size:0.68rem;">Air Quality (AQI)</div>
                    <div style="font-weight:600; color:${aqiColour};">${aqi}</div>
                </div>
                <div style="grid-column:1/-1; background:rgba(255,255,255,0.05); padding:8px; border-radius:6px; margin-top:4px;">
                    <div style="color:#94a3b8; font-size:0.65rem; text-transform:uppercase; margin-bottom:6px; font-weight:600; letter-spacing:0.5px;">Meteorological Conditions</div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="font-size:1.1rem; filter: hue-rotate(${temp > 35 ? '-30deg' : '0deg'});">🌡️</span>
                            <span style="font-weight:600; font-size:0.95rem;">${temp}°C</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;" title="Wind Direction: ${windDir}°">
                            <span style="font-size:1.1rem; transform: rotate(${windDir}deg); display:inline-block;">⬆️</span>
                            <span style="font-weight:600; font-size:0.95rem;">${wind} <span style="font-size:0.7rem; color:#94a3b8;">km/h</span></span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="font-size:1.1rem;">💧</span>
                            <span style="font-weight:600; font-size:0.95rem;">${parseFloat(p.humidity||0).toFixed(0)}%</span>
                        </div>
                    </div>
                </div>
                <div style="grid-column:1/-1;">
                    <div style="color:#64748b; font-size:0.68rem; margin-bottom:3px;">
                        Persistence (30-day recurrence) — ${persistBar}%
                    </div>
                    <div style="background:rgba(255,255,255,0.08); border-radius:3px; height:5px; overflow:hidden;">
                        <div style="width:${persistBar}%; background:${persistColour}; height:100%; border-radius:3px;"></div>
                    </div>
                    <div style="font-size:0.65rem; color:#64748b; margin-top:2px;">
                        ${persistence > 0.7 ? '🔁 Persistent source (likely flare/plant)' :
                          persistence > 0.3 ? '↩️ Recurring detection' : '⚡ New / one-off event'}
                    </div>
                </div>
                <div style="grid-column:1/-1; border-top:1px solid #1e293b; padding-top:6px; margin-top:2px;">
                    <div style="color:#64748b; font-size:0.68rem;">Satellite Acquisition</div>
                    <div style="font-weight:500; font-size:0.8rem;">
                        ${p.acq_date} · ${formatAcqTime(p.acq_time)}
                        · ${p.satellite || 'VIIRS'}
                    </div>
                </div>
                ${(cls === 'Accidental Industrial Fire' || cls === 'Gas Leakage (Chemical)' || cls === 'Wildfire' || cls === 'Industrial Flare') ? `
                <div style="grid-column:1/-1; margin-top:6px;">
                    <button onclick="window.toggleEvacPlan(this, ${p.latitude}, ${p.longitude}, ${parseFloat(frp||0)}, '${cls}')" 
                            style="width:100%; background:${cls === 'Industrial Flare' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(220, 38, 38, 0.2)'}; color:${cls === 'Industrial Flare' ? '#6ee7b7' : '#fca5a5'}; border:1px solid ${cls === 'Industrial Flare' ? '#10b981' : '#dc2626'}; padding:6px; border-radius:4px; font-family:'Outfit'; font-weight:600; cursor:pointer; font-size:0.75rem; transition: background 0.2s;"
                            onmouseover="this.style.background='${cls === 'Industrial Flare' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(220, 38, 38, 0.4)'}'"
                            onmouseout="this.style.background='${cls === 'Industrial Flare' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(220, 38, 38, 0.2)'}'">
                        ${cls === 'Industrial Flare' ? '📋 View Monitoring Protocol' : '🚨 View Evacuation & Action Plan'}
                    </button>
                    <div style="display:none; background:${cls === 'Industrial Flare' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(220, 38, 38, 0.1)'}; border:1px solid ${cls === 'Industrial Flare' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(220, 38, 38, 0.3)'}; padding:8px; border-radius:4px; margin-top:4px;">
                        <ul style="margin:0; padding-left:18px; font-size:0.75rem; color:${cls === 'Industrial Flare' ? '#6ee7b7' : '#fca5a5'}; line-height:1.4;">
                            ${cls === 'Gas Leakage (Chemical)' ? `
                                <li><strong>Immediate:</strong> Evacuate 2km radius upwind</li>
                                <li><strong>Dispatch:</strong> HAZMAT response team</li>
                                <li><strong>Action:</strong> Disable local industrial ignition sources</li>
                            ` : cls === 'Accidental Industrial Fire' ? `
                                <li><strong>Immediate:</strong> Establish 1.5km minimum exclusion zone</li>
                                <li><strong>Dispatch:</strong> Regional emergency & fire services</li>
                                <li><strong>Action:</strong> Activate facility emergency shutdown</li>
                            ` : cls === 'Industrial Flare' ? `
                                <li><strong>Immediate:</strong> Compare intensity against historical 30-day baseline</li>
                                <li><strong>Dispatch:</strong> Not required (Routine Operation)</li>
                                <li><strong>Action:</strong> Log thermal emissions for regulatory compliance</li>
                            ` : `
                                <li><strong>Immediate:</strong> Establish firebreak lines ahead of spread</li>
                                <li><strong>Dispatch:</strong> Request aerial firefighting support</li>
                                <li><strong>Action:</strong> Issue civilian evacuation orders downwind</li>
                            `}
                        </ul>
                    </div>
                </div>
                ` : ''}
            </div>
        </div>`;
}

// ─── Main Data Loader ─────────────────────────────────────────────────────────

function clearHotspotLayers() {
    layerGroups['Accidental Industrial Fire'].clearLayers();
    layerGroups['Industrial Flare'].clearLayers();
    layerGroups['Routine Industrial Heat'].clearLayers();
    layerGroups['Gas Leakage (Chemical)'].clearLayers();
    layerGroups['Smoke Plume'].clearLayers();
    layerGroups['Wildfire'].clearLayers();
    layerGroups['Natural Anomaly'].clearLayers();
    layerGroups['Predictive Fire Spread (Hazard Zone)'].clearLayers();
    layerGroups['Tactical AI Mitigations'].clearLayers();
    window.hotspotDualLayers = [];
}

let analyticsChart = null;
function updateAnalyticsChart(counts) {
    const ctx = document.getElementById('analyticsChart');
    if (!ctx) return;
    
    const data = [counts.accidental, counts.leak, counts.smoke, counts.flare, counts.wildfire];
    if (data.every(v => v === 0)) return; // Wait for data
    
    if (analyticsChart) {
        analyticsChart.data.datasets[0].data = data;
        analyticsChart.update();
    } else {
        analyticsChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Accidental', 'Gas Leak', 'Smoke', 'Flare', 'Wildfire'],
                datasets: [{
                    data: data,
                    backgroundColor: ['#ef4444', '#a855f7', '#94a3b8', '#10b981', '#f59e0b'],
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
        total: 0, accidental: 0, flare: 0, leak: 0, 
        smoke: 0, wildfire: 0, routineHeat: 0, naturalAnomaly: 0
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

    loadZone('industrial', 'Industrial Zones', '#818cf8');
    loadZone('forest', 'Forest / Jungle', '#22c55e');
    loadZone('parks', 'National Parks / Sanctuaries', '#10b981');
    loadZone('agricultural', 'Agricultural / Farmland', '#f59e0b');
    loadZone('mining', 'Mining / Quarry Area', '#f97316');

    // ── 2. Predictive Spread Polygons ─────────────────────────────────────
    fetch('/api/predictive-spread')
        .then(r => r.json())
        .then(data => {
            if (!data.error) {
                layerGroups['Predictive Fire Spread (Hazard Zone)'].clearLayers();
                L.geoJSON(data, {
                    style: {
                        color: '#ef4444',
                        weight: 1,
                        fillColor: '#ef4444',
                        fillOpacity: 0.2,
                        dashArray: '4, 4',
                    },
                    onEachFeature: function(feature, layer) {
                        const p = feature.properties;
                        layer.bindPopup(`
                            <div style="font-family:'Outfit'; color:#e2e8f0;">
                                <h4 style="color:#ef4444; margin:0 0 5px 0;">🔥 Hazard Spread Zone</h4>
                                <p style="margin:0; font-size:0.8rem;">
                                    Predicted speed: <strong>${parseFloat(p.spread_speed_kmh||0).toFixed(1)} km/h</strong><br>
                                    Classification: <span style="color:#ef4444;">${p.ai_classification||'Fire'}</span><br>
                                    Confidence: <span style="color:#10b981;">${parseFloat(p.ai_confidence||0).toFixed(1)}%</span>
                                </p>
                            </div>`);
                    }
                }).addTo(layerGroups['Predictive Fire Spread (Hazard Zone)']);
            }
        })
        .catch(() => {});

    // ── 3. Tactical Mitigations ───────────────────────────────────────────
    fetch('/api/mitigations')
        .then(r => r.json())
        .then(data => {
            if (!data.error) {
                layerGroups['Tactical AI Mitigations'].clearLayers();
                L.geoJSON(data, {
                    style: function(feature) {
                        if (feature.properties.mitigation_type === 'Firebreak') {
                            return { color: '#fbbf24', weight: 4, dashArray: '10, 6' };
                        }
                        return {
                            color: '#dc2626', weight: 2,
                            fillColor: '#dc2626', fillOpacity: 0.15,
                        };
                    },
                    onEachFeature: function(feature, layer) {
                        const isFirebreak = feature.properties.mitigation_type === 'Firebreak';
                        const title = isFirebreak ? '⛏️ Recommended Firebreak Line' : '🚨 Evacuation Perimeter';
                        const col = isFirebreak ? '#fbbf24' : '#dc2626';
                        layer.bindPopup(`
                            <div style="font-family:'Outfit'; color:#e2e8f0;">
                                <h4 style="color:${col}; margin:0 0 5px 0;">${title}</h4>
                                <p style="margin:0; font-size:0.8rem; color:#94a3b8;">
                                    ${isFirebreak
                                        ? 'AI-recommended tree-cut line ahead of fire spread vector.'
                                        : 'Minimum safe standoff zone for chemical/explosion hazard.'}
                                </p>
                            </div>`);
                    }
                }).addTo(layerGroups['Tactical AI Mitigations']);
            }
        })
        .catch(() => {});

    // ── 4. Hotspot Points ─────────────────────────────────────────────────
    fetch('/api/hotspots')
        .then(r => r.json())
        .then(data => {
            if (data.error) return;

            // Clear only hotspot layers here (after data arrives — prevents flicker)
            clearHotspotLayers();

            L.geoJSON(data, {
                style: function(feature) {
                    const cls = feature.properties.ai_classification;
                    const colour = CLASS_COLOURS[cls] || '#f59e0b';
                    const isCritical = cls === 'Accidental Industrial Fire' || cls === 'Gas Leakage (Chemical)';
                    
                    return {
                        color: colour,
                        weight: isCritical ? 2 : 1.5,
                        fillColor: colour,
                        fillOpacity: isCritical ? 0.65 : 0.4,
                        dashArray: (cls === 'Gas Leakage (Chemical)' || cls === 'Smoke Plume') ? '5, 5' : ''
                    };
                },
                onEachFeature: function(feature, layer) {
                    counts.total++;
                    const cls = feature.properties.ai_classification;

                    // Accumulate stats
                    if (cls === 'Accidental Industrial Fire') counts.accidental++;
                    else if (cls === 'Industrial Flare') counts.flare++;
                    else if (cls === 'Routine Industrial Heat') counts.routineHeat++;
                    else if (cls === 'Gas Leakage (Chemical)')counts.leak++;
                    else if (cls === 'Smoke Plume')           counts.smoke++;
                    else if (cls === 'Wildfire') counts.wildfire++;
                    else if (cls === 'Natural Anomaly') counts.naturalAnomaly++;

                    const isCritical = cls === 'Accidental Industrial Fire' || cls === 'Gas Leakage (Chemical)';
                    const pixelRadius = isCritical ? 10 : 7;
                    const colour = CLASS_COLOURS[cls] || '#f59e0b';
                    
                    const center = layer.getBounds().getCenter();
                    const circle = L.circleMarker(center, {
                        radius: pixelRadius,
                        fillColor: colour,
                        color: colour,
                        weight: isCritical ? 2 : 1,
                        opacity: 1,
                        fillOpacity: isCritical ? 0.9 : 0.7,
                    });

                    layer.bindPopup(buildPopupHTML(feature), { maxWidth: 320 });
                    circle.bindPopup(buildPopupHTML(feature), { maxWidth: 320 });

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

            // Update stat counters with animation
            animateValue('total-hotspots', 0, counts.total,     1200);
            animateValue('accidental-count', 0, counts.accidental, 1200);
            animateValue('leak-count',  0, counts.leak,     1200);
            animateValue('smoke-count', 0, counts.smoke,    1200);
            animateValue('flare-count', 0, counts.flare,    1200);
            animateValue('routine-heat-count', 0, counts.routineHeat, 1200);
            animateValue('wildfire-count', 0, counts.wildfire, 1200);
            animateValue('natural-anomaly-count', 0, counts.naturalAnomaly, 1200);

            // Update critical alert banner
            const alertEl = document.getElementById('critical-alert');
            if (alertEl) {
                const criticalCount = counts.accidental + counts.leak + counts.wildfire;
                alertEl.style.display = criticalCount > 0 ? 'flex' : 'none';
                const alertText = document.getElementById('alert-text');
                if (alertText) {
                    alertText.innerText = `⚠️  ${criticalCount} CRITICAL alert${criticalCount > 1 ? 's' : ''} detected (Fires/Leaks)`;
                }
            }

            // Populate Live Incident Feed
            const feedContainer = document.getElementById('incident-feed-container');
            if (feedContainer && data.features) {
                feedContainer.innerHTML = ''; // Clear awaiting message
                let feedHTML = '';
                
                // Sort features by FRP (highest first) to show most critical incidents
                const sortedFeatures = data.features
                    .filter(f => f.properties.ai_classification !== 'Routine Industrial Heat' && f.properties.ai_classification !== 'Natural Anomaly')
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
                        
                        if (cls === 'Accidental Industrial Fire') {
                            baselineFRP = 3.1; // normal industrial heat
                        } else if (cls === 'Wildfire') {
                            baselineFRP = 1.5; // normal natural smolder
                        }
                        
                        if (cls === 'Gas Leakage (Chemical)' || cls === 'Smoke Plume') {
                            relativeText = `<span style="color: #ef4444; font-weight:bold; font-size: 0.7rem;">(Hazardous)</span>`;
                        } else {
                            const percentAboveNormal = Math.round(((parseFloat(frp) - baselineFRP) / baselineFRP) * 100);
                            if (percentAboveNormal > 0) {
                                relativeText = `<span style="color: #ef4444; font-weight:bold; font-size: 0.7rem;">(+${percentAboveNormal}% above normal)</span>`;
                            }
                        }
                        
                        feedHTML += `
                        <div class="feed-item" onclick="flyToIncident(${p.latitude}, ${p.longitude})">
                            <div class="feed-title" style="color: ${colour}; display: flex; justify-content: space-between;">
                                <span>${cls}</span>
                                ${relativeText}
                            </div>
                            <div class="feed-meta">
                                <span>FRP: ${frp} MW</span>
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
        .catch(err => console.error('Error loading hotspots:', err));
}

// ─── Live Clock ───────────────────────────────────────────────────────────────
function updateClock() {
    const el = document.getElementById('current-time');
    if (el) {
        const now = new Date();
        el.innerText = now.toLocaleTimeString('en-IN', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZone: 'Asia/Kolkata', hour12: false
        }) + ' IST';
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
    if (isShowing && (cls === 'Accidental Industrial Fire' || cls === 'Gas Leakage (Chemical)' || cls === 'Wildfire')) {
        let radiusKm = Math.max(parseFloat(frp) * 0.08, 1.5);
        if (cls === 'Gas Leakage (Chemical)') radiusKm = Math.max(radiusKm, 2.0);
        let radiusMeters = radiusKm * 1000;
        
        window.activeEvacCircle = L.circle([lat, lon], {
            color: '#ef4444',
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
setInterval(loadData, 30000);   // Refresh every 30s
setInterval(updateClock, 1000);
updateClock();

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
