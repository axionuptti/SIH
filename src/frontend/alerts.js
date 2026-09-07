/**
 * SIH26162 Emergency Citizen & First Responder Alert Portal
 * Functional Tactical Engine Matching Main Dashboard Theme
 */

(function () {
    "use strict";

    // ── Global State ─────────────────────────────────────────────────────────
    let currentLat = 47.3517;
    let currentLon = 34.9868;
    let currentRadiusKm = 50;
    let currentLocationLabel = "Dniprorudne Timber & Industrial Sector";
    
    let activeTab = "civilian"; // 'civilian' | 'responder'
    let isDrawerOpen = false;
    let currentAlertData = null;

    let map = null;
    let userMarker = null;
    let bufferCircles = [];
    let fireMarkersLayer = null;
    let escapeVectorLayer = null;
    let smokePlumeLayer = null;
    let sheltersLayer = null;

    let searchDebounceTimer = null;
    const STORAGE_KEY_CHECKED = "sih_evac_checked_steps_v1";

    // ── Tactical Emergency Sound Engine (Industrial Horn Hooter & Single Beep) ─
    const EmergencySoundSystem = {
        audioContext: null,
        currentMode: "SILENT", // 'CRITICAL_HOOTER' | 'MODERATE_BEEP' | 'SILENT'
        isMutedByUser: false,
        isAutoplayBlocked: false,
        hooterTimer: null,
        beepTimer: null,

        init() {
            // Guarantee any legacy audio element is paused and reset to silence
            const el = document.getElementById("emergency-siren-audio");
            if (el) {
                try {
                    el.pause();
                    el.currentTime = 0;
                } catch (e) {}
            }
        },

        ensureAudioContext() {
            if (!this.audioContext) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    this.audioContext = new AudioCtx();
                }
            }
            if (this.audioContext && this.audioContext.state === "suspended") {
                this.audioContext.resume().catch(() => {});
            }
            return this.audioContext;
        },

        // Play ONLY the Industrial Evacuation Hooter (Deep steady horn blast, NO pitch-wobble/tee-tuu)
        playCriticalHooter() {
            if (this.isMutedByUser) {
                this.updateUI();
                return;
            }
            // If already actively sounding the evacuation hooter, don't duplicate
            if (this.currentMode === "CRITICAL_HOOTER" && this.hooterTimer) {
                return;
            }

            // Strictly stop ANY existing sound before starting
            this.stopAll(false);
            this.currentMode = "CRITICAL_HOOTER";

            const triggerHooterBlast = () => {
                if (this.currentMode !== "CRITICAL_HOOTER" || this.isMutedByUser) return;
                const ctx = this.ensureAudioContext();
                if (!ctx) return;

                if (ctx.state === "suspended") {
                    ctx.resume().catch(() => {
                        this.isAutoplayBlocked = true;
                        this.updateUI();
                    });
                }

                try {
                    const now = ctx.currentTime;
                    const blastDuration = 1.0; // 1.0 second steady horn blast

                    // Heavy acoustic horn gain envelope
                    const gainNode = ctx.createGain();
                    gainNode.gain.setValueAtTime(0.001, now);
                    gainNode.gain.linearRampToValueAtTime(0.35, now + 0.04);
                    gainNode.gain.setValueAtTime(0.35, now + blastDuration - 0.05);
                    gainNode.gain.linearRampToValueAtTime(0.001, now + blastDuration);

                    // Lowpass filter for deep acoustic diaphragm resonance (removes all high screeching)
                    const filter = ctx.createBiquadFilter();
                    filter.type = "lowpass";
                    filter.frequency.setValueAtTime(1100, now);
                    filter.Q.setValueAtTime(1.8, now);

                    // Primary Horn: Steady 360 Hz (NO frequency modulation, NO pitch shift, NO tee-tuu)
                    const osc = ctx.createOscillator();
                    osc.type = "sawtooth";
                    osc.frequency.setValueAtTime(360, now);

                    // Sub-octave resonance: 180 Hz for heavy industrial diaphragm body
                    const subOsc = ctx.createOscillator();
                    subOsc.type = "triangle";
                    subOsc.frequency.setValueAtTime(180, now);

                    osc.connect(filter);
                    subOsc.connect(filter);
                    filter.connect(gainNode);
                    gainNode.connect(ctx.destination);

                    osc.start(now);
                    subOsc.start(now);
                    osc.stop(now + blastDuration + 0.02);
                    subOsc.stop(now + blastDuration + 0.02);
                } catch (err) {
                    console.warn("Hooter blast error:", err);
                }
            };

            triggerHooterBlast();
            this.hooterTimer = setInterval(triggerHooterBlast, 1350); // Steady 1.0s blast with 0.35s breath
            this.updateUI();
        },

        // Play ONLY the Moderate Advisory Beep (Single clean beep, NO tee-tuu)
        playModerateBeep() {
            if (this.isMutedByUser) {
                this.updateUI();
                return;
            }
            if (this.currentMode === "MODERATE_BEEP" && this.beepTimer) {
                return;
            }

            // Strictly stop ANY existing sound before starting
            this.stopAll(false);
            this.currentMode = "MODERATE_BEEP";

            const triggerBeep = () => {
                if (this.currentMode !== "MODERATE_BEEP" || this.isMutedByUser) return;
                const ctx = this.ensureAudioContext();
                if (!ctx) return;

                if (ctx.state === "suspended") {
                    ctx.resume().catch(() => {
                        this.isAutoplayBlocked = true;
                        this.updateUI();
                    });
                }

                try {
                    const now = ctx.currentTime;
                    // Single clean advisory beep: 700 Hz, 85ms duration
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = "sine";
                    osc.frequency.setValueAtTime(700, now);
                    gain.gain.setValueAtTime(0.001, now);
                    gain.gain.linearRampToValueAtTime(0.20, now + 0.015);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);

                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now);
                    osc.stop(now + 0.095);
                } catch (e) {
                    console.warn("Beep sound error:", e);
                }
            };

            triggerBeep();
            this.beepTimer = setInterval(triggerBeep, 1600); // Pulse single calm beep every 1.6s
            this.updateUI();
        },

        // Completely stop and tear down all sound immediately
        stopAll(userInitiated = false) {
            if (userInitiated) {
                this.isMutedByUser = true;
            }

            this.currentMode = "SILENT";

            // 1. Clear hooter interval
            if (this.hooterTimer) {
                clearInterval(this.hooterTimer);
                this.hooterTimer = null;
            }

            // 2. Clear beep interval
            if (this.beepTimer) {
                clearInterval(this.beepTimer);
                this.beepTimer = null;
            }

            // 3. Halt legacy audio element
            const el = document.getElementById("emergency-siren-audio");
            if (el) {
                try {
                    el.pause();
                    el.currentTime = 0;
                } catch (e) {}
            }

            this.updateUI();
        },

        unmuteAndReevaluate(data) {
            this.isMutedByUser = false;
            this.isAutoplayBlocked = false;
            this.ensureAudioContext();
            this.evaluate(data);
        },

        // Central Single-Source Decision Engine
        evaluate(data) {
            if (!data) return;
            const threat = data.threat_level; // 'CRITICAL DANGER' | 'HIGH THREAT' | 'MONITORING ADVISORY' | 'SAFE ZONE' | 'STANDBY'

            if (threat === "CRITICAL DANGER" || threat === "HIGH THREAT") {
                // Critical Zone: Play ONLY the Industrial Evacuation Hooter
                this.playCriticalHooter();
            } else if (threat === "MONITORING ADVISORY") {
                // Moderate Zone: Play ONLY the Warning Beep
                this.playModerateBeep();
            } else {
                // Safe Zone / Standby: Complete Silence
                this.stopAll(false);
            }
        },

        updateUI() {
            const btnText = document.getElementById("alarm-btn-text");
            const btnIcon = document.getElementById("alarm-btn-icon");
            const toggleBtn = document.getElementById("btn-alarm-toggle");
            const bannerSirenBtn = document.getElementById("banner-siren-btn");

            if (this.currentMode === "CRITICAL_HOOTER") {
                if (btnText) btnText.textContent = "🚨 STOP HOOTER";
                if (btnIcon) btnIcon.textContent = "🔇";
                if (toggleBtn) {
                    toggleBtn.style.background = "linear-gradient(135deg, #ef4444, #dc2626)";
                    toggleBtn.style.borderColor = "#ffffff";
                    toggleBtn.style.color = "#ffffff";
                    toggleBtn.style.animation = "alertPulse 0.9s infinite alternate";
                    toggleBtn.title = "Critical Evacuation Hooter is sounding. Click to stop alarm.";
                }
                if (bannerSirenBtn) {
                    bannerSirenBtn.textContent = "🔇 Stop Hooter";
                    bannerSirenBtn.style.background = "#ef4444";
                    bannerSirenBtn.style.borderColor = "#ffffff";
                }
            } else if (this.currentMode === "MODERATE_BEEP") {
                if (btnText) btnText.textContent = "⚠️ STOP BEEP";
                if (btnIcon) btnIcon.textContent = "🔇";
                if (toggleBtn) {
                    toggleBtn.style.background = "linear-gradient(135deg, #f59e0b, #d97706)";
                    toggleBtn.style.borderColor = "#ffffff";
                    toggleBtn.style.color = "#ffffff";
                    toggleBtn.style.animation = "alertPulse 1.4s infinite alternate";
                    toggleBtn.title = "Moderate Warning Alert Beep is sounding. Click to stop alarm.";
                }
                if (bannerSirenBtn) {
                    bannerSirenBtn.textContent = "🔇 Stop Beep";
                    bannerSirenBtn.style.background = "#f59e0b";
                    bannerSirenBtn.style.borderColor = "#ffffff";
                }
            } else {
                // SILENT MODE (either Safe Zone or Muted by user)
                if (this.isMutedByUser) {
                    const threat = currentAlertData ? currentAlertData.threat_level : "";
                    const isCrit = threat === "CRITICAL DANGER" || threat === "HIGH THREAT";
                    if (btnText) btnText.textContent = isCrit ? "🚨 RESUME HOOTER" : "⚠️ RESUME BEEP";
                    if (btnIcon) btnIcon.textContent = "🔊";
                    if (toggleBtn) {
                        toggleBtn.style.background = "rgba(239, 68, 68, 0.2)";
                        toggleBtn.style.borderColor = isCrit ? "#ef4444" : "#f59e0b";
                        toggleBtn.style.color = "#f8fafc";
                        toggleBtn.style.animation = "none";
                        toggleBtn.title = "Alarm was stopped by user. Click to resume sounding.";
                    }
                    if (bannerSirenBtn) {
                        bannerSirenBtn.textContent = isCrit ? "🔊 Resume Hooter" : "🔊 Resume Beep";
                        bannerSirenBtn.style.background = "rgba(0,0,0,0.5)";
                        bannerSirenBtn.style.borderColor = "rgba(255,255,255,0.4)";
                    }
                } else {
                    // Safe Zone / Standby
                    if (btnText) btnText.textContent = "Alarm: SAFE (Silent)";
                    if (btnIcon) btnIcon.textContent = "🛡️";
                    if (toggleBtn) {
                        toggleBtn.style.background = "rgba(16, 185, 129, 0.15)";
                        toggleBtn.style.borderColor = "rgba(16, 185, 129, 0.4)";
                        toggleBtn.style.color = "#a7f3d0";
                        toggleBtn.style.animation = "none";
                        toggleBtn.title = "Sector is safe. Emergency sound armed in silent standby.";
                    }
                    if (bannerSirenBtn) {
                        bannerSirenBtn.textContent = "🔊 Test Alarm";
                        bannerSirenBtn.style.background = "rgba(0,0,0,0.4)";
                        bannerSirenBtn.style.borderColor = "rgba(255,255,255,0.2)";
                    }
                }
            }
        }
    };

    // ── Initialization ───────────────────────────────────────────────────────
    document.addEventListener("DOMContentLoaded", () => {
        EmergencySoundSystem.init();
        initMap();
        setupSearchInput();
        setupClock();

        // Unlock audio on any first user interaction (click, key, touch)
        const unlockAudio = function () {
            EmergencySoundSystem.ensureAudioContext();
            if (currentAlertData && EmergencySoundSystem.currentMode === "SILENT" && !EmergencySoundSystem.isMutedByUser) {
                EmergencySoundSystem.evaluate(currentAlertData);
            }
            document.removeEventListener("click", unlockAudio);
            document.removeEventListener("keydown", unlockAudio);
            document.removeEventListener("touchstart", unlockAudio);
        };

        document.addEventListener("click", unlockAudio, { passive: true });
        document.addEventListener("keydown", unlockAudio, { passive: true });
        document.addEventListener("touchstart", unlockAudio, { passive: true });

        // Initial scan for default preset (Dniprorudne)
        fetchProximityAlerts(currentLat, currentLon, currentRadiusKm, currentLocationLabel, false);
    });


    // ── Leaflet Tactical Map Initialization ──────────────────────────────────
    function initMap() {
        const mapContainer = document.getElementById("radar-map");
        if (!mapContainer) return;

        map = L.map("radar-map", {
            zoomControl: true,
            attributionControl: false
        }).setView([currentLat, currentLon], 10);

        // Dark Matter Basemap (Matches Main Dashboard)
        const BASEMAPS_API_KEY = "cb1_2zsc_1_6906339c23d46ebbaf5c5c8c";
        L.tileLayer(`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=${BASEMAPS_API_KEY}`, {
            maxZoom: 18,
            subdomains: "abcd"
        }).addTo(map);

        smokePlumeLayer = L.layerGroup().addTo(map);
        escapeVectorLayer = L.layerGroup().addTo(map);
        sheltersLayer = L.layerGroup().addTo(map);
        fireMarkersLayer = L.layerGroup().addTo(map);

        // Interactive map click: Click anywhere on Earth to drop pin and analyze!
        map.on("click", (e) => {
            const { lat, lng } = e.latlng;
            document.getElementById("input-lat").value = lat.toFixed(4);
            document.getElementById("input-lon").value = lng.toFixed(4);
            clearActivePresetChips();
            reverseGeocode(lat, lng);
            fetchProximityAlerts(lat, lng, currentRadiusKm, `Pin (${lat.toFixed(3)}, ${lng.toFixed(3)})`, true);
        });
    }

    // ── Proximity API Call ───────────────────────────────────────────────────
    async function fetchProximityAlerts(lat, lon, radiusKm, locationName, resetMute = true) {
        currentLat = lat;
        currentLon = lon;
        currentRadiusKm = radiusKm;
        if (locationName) currentLocationLabel = locationName;

        if (resetMute) {
            EmergencySoundSystem.isMutedByUser = false;
        }

        updateLocationBadge(currentLat, currentLon, currentLocationLabel);

        try {
            const res = await fetch(`/api/alerts/proximity?lat=${lat}&lon=${lon}&radius_km=${radiusKm}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            currentAlertData = data;
            renderAll(data);
        } catch (err) {
            console.warn("Proximity API call failed, calculating client-side fallback radar:", err);
            fallbackClientProximity(lat, lon, radiusKm);
        }
    }

    // ── Client-side Fallback Radar ───────────────────────────────────────────
    async function fallbackClientProximity(userLat, userLon, radiusKm) {
        try {
            const res = await fetch("/api/hotspots");
            const geojson = await res.json();
            const features = geojson.features || [];

            const nearby = [];
            for (const f of features) {
                const p = f.properties || {};
                const fLat = parseFloat(p.latitude || 0);
                const fLon = parseFloat(p.longitude || 0);
                if (!fLat && !fLon) continue;

                const dist = haversine(userLat, userLon, fLat, fLon);
                if (dist <= radiusKm) {
                    const bearing = calculateBearing(userLat, userLon, fLat, fLon);
                    const windDir = parseFloat(p.wind_direction || 220);
                    const plumeHeading = (windDir + 180) % 360;
                    const angleDiff = Math.abs((((bearing + 180) % 360) - plumeHeading + 180) % 360 - 180);
                    const isDownwind = angleDiff <= 45;

                    nearby.push({
                        latitude: fLat,
                        longitude: fLon,
                        distance_km: Math.round(dist * 10) / 10,
                        bearing_degrees: bearing,
                        bearing_cardinal: getCardinal(bearing),
                        is_downwind: isDownwind,
                        classification: p.ai_classification || "Wildfire",
                        frp: parseFloat(p.frp || 25),
                        risk_level: p.risk_level || "Medium",
                        location_name: p.location_name || `${p.city || ""} ${p.country || ""}`.trim() || "Thermal Hotspot",
                        wind_speed: parseFloat(p.wind_speed || 14),
                        wind_direction: windDir,
                        aqi: parseInt(p.aqi || 85, 10),
                        temperature: parseFloat(p.temperature || 29),
                        humidity: parseFloat(p.humidity || 45)
                    });
                }
            }

            nearby.sort((a, b) => a.distance_km - b.distance_km);
            const closest = nearby[0] || null;
            const minDist = closest ? closest.distance_km : 999;
            let threatLevel = "SAFE ZONE";
            let threatColor = "#10b981";
            let shouldSound = false;

            if (minDist <= 10) {
                threatLevel = "CRITICAL DANGER";
                threatColor = "#ef4444";
                shouldSound = true;
            } else if (minDist <= 25) {
                threatLevel = "HIGH THREAT";
                threatColor = "#f97316";
            } else if (minDist <= 50) {
                threatLevel = "MONITORING ADVISORY";
                threatColor = "#eab308";
            }

            const rawEscape = closest ? (closest.bearing_degrees + 180) % 360 : 0;
            const escapeHeading = closest && closest.is_downwind ? (rawEscape + 90) % 360 : rawEscape;
            const bufferKm = closest ? Math.max(Math.round(closest.frp * 0.08 * 10) / 10, 2.5) : 0;

            const fallbackData = {
                user_coordinates: { latitude: userLat, longitude: userLon },
                search_radius_km: radiusKm,
                threat_level: threatLevel,
                threat_color: threatColor,
                urgency_score: minDist <= 10 ? 95 : minDist <= 25 ? 75 : minDist <= 50 ? 45 : 10,
                status_description: closest ? `Active fire anomaly detected ${minDist} km away.` : `No thermal hotspots within ${radiusKm} km.`,
                should_sound_alarm: shouldSound,
                fires_in_radius: nearby.length,
                closest_fire: closest,
                peak_frp_mw: nearby.length ? Math.max(...nearby.map(n => n.frp)) : 0,
                escape_heading: {
                    degrees: Math.round(escapeHeading),
                    cardinal: getCardinal(escapeHeading),
                    tactical_note: closest && closest.is_downwind ? "Crosswind egress vector recommended to escape dense smoke corridor." : "Direct egress vector away from primary fire front.",
                    safe_buffer_km: bufferKm
                },
                smoke_plume: {
                    is_user_downwind: closest ? closest.is_downwind : false,
                    plume_polygon: []
                },
                designated_shelters: [
                    {
                        name: "Community Safe Evacuation Assembly Hub",
                        type: "Primary Civilian Shelter",
                        distance_km: Math.round(bufferKm + 3.0),
                        bearing_cardinal: getCardinal(escapeHeading),
                        capacity: "1,200 Persons · Air Filtration & Power Active",
                        status: "OPEN & ACTIVE"
                    },
                    {
                        name: "District Emergency Trauma & Medical Post",
                        type: "Hospital & First-Aid Post",
                        distance_km: Math.round(bufferKm + 5.5),
                        bearing_cardinal: getCardinal((escapeHeading + 25) % 360),
                        capacity: "Burn Unit & Oxygen Therapy Active",
                        status: "TRIAGE STANDBY"
                    }
                ],
                weather: {
                    temperature_c: closest ? closest.temperature : 28,
                    humidity_pct: closest ? closest.humidity : 45,
                    wind_speed_kmh: closest ? closest.wind_speed : 12,
                    wind_direction_deg: closest ? closest.wind_direction : 220,
                    wind_cardinal: getCardinal(closest ? closest.wind_direction : 220)
                },
                air_quality: {
                    aqi: closest ? (closest.is_downwind ? closest.aqi + 90 : closest.aqi) : 45,
                    category: closest && closest.is_downwind ? "Very Unhealthy" : "Moderate",
                    health_advisory: "Wear P100/N95 respirator to prevent particulate ash inhalation."
                },
                evacuation_steps: [
                    {
                        phase: "Phase 1: Immediate Egress",
                        action: "Move along Safe Heading",
                        details: `Evacuate in heading ${Math.round(escapeHeading)}° (${getCardinal(escapeHeading)}). Don an N95 respirator or folded damp cloth.`
                    },
                    {
                        phase: "Phase 2: Property Hardening",
                        action: "Isolate LPG & Fuel Inlets",
                        details: "Turn off gas supply valves and air conditioners. Leave doors unlocked for emergency rescue access."
                    },
                    {
                        phase: "Phase 3: Vehicle Corridor",
                        action: "Proceed to Safety Buffer",
                        details: `Drive headlights ON toward safe assembly center at least ${bufferKm} km away.`
                    },
                    {
                        phase: "Phase 4: Emergency Contacts",
                        action: "Alert Local Dispatch",
                        details: "Dial Fire Brigade 101 / 911 or Police 100 with your GPS location."
                    }
                ],
                fire_control_strategy: {
                    fuel_class: closest && closest.classification.includes("Industrial") ? "Class B Hydrocarbon" : "Class A Wildland",
                    primary_suppressant: closest && closest.classification.includes("Industrial") ? "AR-AFFF Foam & Purple-K" : "Bulldozer Firebreaks & Retardant",
                    critical_warning: "DO NOT apply straight stream water directly into open liquid fuel pools.",
                    containment_perimeter: `Minimum ${bufferKm} km standoff perimeter.`
                },
                responder_metrics: {
                    water_flow_required_lpm: Math.round((closest ? closest.frp : 50) * 45),
                    foam_concentrate_lpm: Math.round((closest ? closest.frp : 50) * 45 * 0.03),
                    tanker_trucks_recommended: 3,
                    deluge_lines_recommended: 4,
                    standoff_distance_km: bufferKm
                },
                nearby_hotspots: nearby
            };

            currentAlertData = fallbackData;
            renderAll(fallbackData);
        } catch (e) {
            console.error("Fallback failed:", e);
        }
    }

    // ── Render All Sections ──────────────────────────────────────────────────
    function renderAll(data) {
        renderSidebarStats(data);
        renderTopBanner(data);
        renderWeatherAndAir(data);
        renderEscapeVector(data);
        renderChecklist(data.evacuation_steps || []);
        renderShelters(data.designated_shelters || []);
        renderResponderTab(data);
        renderMap(data);

        // Evaluate emergency audio system:
        // Critical Zone: Continuous Evacuation Hooter until stopped
        // Moderate Zone: Continuous Advisory Alert Beep until stopped
        // Safe Zone: Complete Silence (all sounds stopped)
        EmergencySoundSystem.evaluate(data);
    }

    // ── Render Sidebar Stats ─────────────────────────────────────────────────
    function renderSidebarStats(data) {
        const threatLevelEl = document.getElementById("stat-threat-level");
        const nearestDistEl = document.getElementById("stat-nearest-dist");
        const peakFrpEl = document.getElementById("stat-peak-frp");
        const aqiEl = document.getElementById("stat-aqi");

        if (threatLevelEl) {
            threatLevelEl.textContent = data.threat_level;
            threatLevelEl.style.color = data.threat_color;
            threatLevelEl.style.textShadow = `0 0 12px ${data.threat_color}66`;
        }

        const closest = data.closest_fire;
        if (nearestDistEl) {
            nearestDistEl.textContent = closest ? `${closest.distance_km} km` : "None";
            nearestDistEl.style.color = closest && closest.distance_km <= 10 ? "#ef4444" : "#38bdf8";
        }

        if (peakFrpEl) {
            peakFrpEl.textContent = `${data.peak_frp_mw || 0} MW`;
        }

        if (aqiEl && data.air_quality) {
            aqiEl.textContent = `${data.air_quality.aqi} AQI`;
            aqiEl.style.color = data.air_quality.aqi > 150 ? "#ef4444" : data.air_quality.aqi > 100 ? "#f59e0b" : "#10b981";
        }
    }

    // ── Render Top Banner ────────────────────────────────────────────────────
    function renderTopBanner(data) {
        const banner = document.getElementById("critical-alert-banner");
        const title = document.getElementById("banner-title");
        const desc = document.getElementById("banner-desc");
        const icon = banner ? banner.querySelector(".banner-siren-icon") : null;

        if (!banner) return;
        const threat = data.threat_level;

        if (threat === "CRITICAL DANGER" || threat === "HIGH THREAT") {
            banner.style.display = "block";
            banner.classList.remove("moderate");
            if (icon) icon.textContent = "🚨";
            if (title) title.textContent = `${threat}: EVACUATION HOOTER ACTIVE`;
            if (desc) desc.textContent = data.status_description || "Thermal anomaly within immediate hazard perimeter. Evacuation hooter is sounding.";
        } else if (threat === "MONITORING ADVISORY") {
            banner.style.display = "block";
            banner.classList.add("moderate");
            if (icon) icon.textContent = "⚠️";
            if (title) title.textContent = "MONITORING ADVISORY: ALERT BEEP ACTIVE";
            if (desc) desc.textContent = data.status_description || "Thermal anomalies within 50km perimeter. Advisory alert beep is sounding.";
        } else {
            // Safe Zone or Standby: Hide banner
            banner.style.display = "none";
            banner.classList.remove("moderate");
        }

        EmergencySoundSystem.updateUI();
    }

    // ── Render Weather & Air Quality Floating Bar ────────────────────────────
    function renderWeatherAndAir(data) {
        const w = data.weather || {};
        const aq = data.air_quality || {};

        const tempEl = document.getElementById("w-temp");
        const humEl = document.getElementById("w-hum");
        const windEl = document.getElementById("w-wind");
        const windDirEl = document.getElementById("w-wind-dir");
        const smokeHazardEl = document.getElementById("w-smoke-hazard");
        const widget = document.getElementById("weather-widget");

        if (tempEl) tempEl.textContent = `${w.temperature_c || 28}°C`;
        if (humEl) humEl.textContent = `${w.humidity_pct || 45}%`;
        if (windEl) windEl.textContent = `${w.wind_speed_kmh || 12} km/h`;
        if (windDirEl) windDirEl.textContent = `${w.wind_cardinal || "SW"} (${w.wind_direction_deg || 220}°)`;

        if (smokeHazardEl) {
            const isDownwind = data.smoke_plume && data.smoke_plume.is_user_downwind;
            if (isDownwind) {
                smokeHazardEl.textContent = "⚠️ Downwind";
                smokeHazardEl.style.color = "#ef4444";
                if (widget) {
                    widget.style.borderColor = "rgba(239, 68, 68, 0.6)";
                    widget.style.boxShadow = "0 0 20px rgba(239, 68, 68, 0.3)";
                }
            } else {
                smokeHazardEl.textContent = "Normal";
                smokeHazardEl.style.color = "#10b981";
                if (widget) {
                    widget.style.borderColor = "rgba(255, 255, 255, 0.08)";
                    widget.style.boxShadow = "none";
                }
            }
        }
    }

    // ── Render Escape Vector Ribbon ──────────────────────────────────────────
    function renderEscapeVector(data) {
        const headingEl = document.getElementById("vector-heading-text");
        const noteEl = document.getElementById("vector-note-text");
        const bufferEl = document.getElementById("vector-buffer-val");
        const compassIcon = document.getElementById("vector-compass-icon");

        const esc = data.escape_heading;
        if (!esc) return;

        if (headingEl) {
            headingEl.textContent = data.closest_fire ? `Heading ${esc.degrees}° (${esc.cardinal})` : "Area Clear";
        }
        if (noteEl) {
            noteEl.textContent = esc.tactical_note || "Maintain standard situational alertness.";
        }
        if (bufferEl) {
            bufferEl.textContent = esc.safe_buffer_km > 0 ? `${esc.safe_buffer_km} km` : "0 km";
        }
        if (compassIcon && data.closest_fire) {
            compassIcon.style.transform = `rotate(${esc.degrees}deg)`;
        }
    }

    // ── Render Checklist (Persistent with localStorage) ──────────────────────
    function renderChecklist(steps) {
        const container = document.getElementById("checklist-items-scroll");
        if (!container) return;
        container.innerHTML = "";

        const savedDone = getSavedCheckedSteps();

        steps.forEach((step, idx) => {
            const stepKey = `step_${idx}`;
            const isDone = savedDone.includes(stepKey);

            const row = document.createElement("div");
            row.className = `checklist-row ${isDone ? "completed" : ""}`;
            row.onclick = () => toggleChecklistStep(stepKey, row);

            row.innerHTML = `
                <div class="chk-box-indicator">${isDone ? "✓" : ""}</div>
                <div class="step-row-content">
                    <span class="step-row-phase">${escapeHtml(step.phase || `Step ${idx + 1}`)}</span>
                    <h4 class="step-row-title">${escapeHtml(step.action || "")}</h4>
                    <p class="step-row-desc">${escapeHtml(step.details || "")}</p>
                </div>
            `;
            container.appendChild(row);
        });

        updateChecklistProgressUI(steps.length);
    }

    function toggleChecklistStep(stepKey, element) {
        let saved = getSavedCheckedSteps();
        if (saved.includes(stepKey)) {
            saved = saved.filter(k => k !== stepKey);
            element.classList.remove("completed");
            element.querySelector(".chk-box-indicator").textContent = "";
        } else {
            saved.push(stepKey);
            element.classList.add("completed");
            element.querySelector(".chk-box-indicator").textContent = "✓";
        }
        localStorage.setItem(STORAGE_KEY_CHECKED, JSON.stringify(saved));
        const total = document.querySelectorAll(".checklist-row").length;
        updateChecklistProgressUI(total);
    }

    function updateChecklistProgressUI(total) {
        const saved = getSavedCheckedSteps();
        const done = saved.length;
        const badge = document.getElementById("drawer-progress-text");
        if (badge) {
            badge.textContent = `${done} / ${total} Steps Done`;
            if (done === total && total > 0) {
                badge.style.background = "rgba(16, 185, 129, 0.3)";
                badge.style.color = "#10b981";
            }
        }
    }

    window.resetChecklist = function () {
        localStorage.removeItem(STORAGE_KEY_CHECKED);
        document.querySelectorAll(".checklist-row").forEach(r => {
            r.classList.remove("completed");
            r.querySelector(".chk-box-indicator").textContent = "";
        });
        const total = document.querySelectorAll(".checklist-row").length;
        updateChecklistProgressUI(total);
    };

    function getSavedCheckedSteps() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY_CHECKED) || "[]");
        } catch {
            return [];
        }
    }

    // ── Render Designated Shelters ───────────────────────────────────────────
    function renderShelters(shelters) {
        const container = document.getElementById("shelters-scroll-list");
        const badge = document.getElementById("dock-shelters-badge");
        if (badge) badge.textContent = `${shelters.length} Shelters`;
        if (!container) return;

        if (shelters.length === 0) {
            container.innerHTML = `<div style="padding:16px; text-align:center; color:#64748b; font-size:0.8rem;">No emergency evacuation hubs needed. Area is secure.</div>`;
            return;
        }

        container.innerHTML = "";
        shelters.forEach(sh => {
            const card = document.createElement("div");
            card.className = "shelter-card";
            const icon = sh.type.includes("Hospital") ? "🏥" : sh.type.includes("Responder") ? "🚒" : "🛡️";

            card.innerHTML = `
                <div class="shelter-left">
                    <span class="shelter-icon">${icon}</span>
                    <div>
                        <div class="shelter-name">${escapeHtml(sh.name)}</div>
                        <div class="shelter-sub">${escapeHtml(sh.capacity)}</div>
                    </div>
                </div>
                <div class="shelter-right">
                    <div class="shelter-dist">${sh.distance_km} km</div>
                    <div class="shelter-status">${sh.status}</div>
                </div>
            `;

            card.onclick = () => {
                if (map && sh.latitude && sh.longitude) {
                    map.flyTo([sh.latitude, sh.longitude], 13, { duration: 1.2 });
                }
            };
            container.appendChild(card);
        });
    }

    // ── Render First Responder Tab ───────────────────────────────────────────
    function renderResponderTab(data) {
        const metrics = data.responder_metrics || {};
        const strat = data.fire_control_strategy || {};

        const flowEl = document.getElementById("resp-flow");
        const foamEl = document.getElementById("resp-foam");
        const tankersEl = document.getElementById("resp-tankers");
        const delugeEl = document.getElementById("resp-deluge");
        const warningEl = document.getElementById("tactic-warning-text");

        const fuelTag = document.getElementById("resp-fuel-tag");
        const suppText = document.getElementById("resp-suppressant-text");
        const perimText = document.getElementById("resp-perimeter-text");
        const ppeText = document.getElementById("resp-ppe-text");

        if (flowEl) flowEl.textContent = `${metrics.water_flow_required_lpm || 1200} L/min`;
        if (foamEl) foamEl.textContent = `${metrics.foam_concentrate_lpm || 36} L/min`;
        if (tankersEl) tankersEl.textContent = `${metrics.tanker_trucks_recommended || 2} Units`;
        if (delugeEl) delugeEl.textContent = `${metrics.deluge_lines_recommended || 3} Lines`;
        if (warningEl) warningEl.textContent = strat.critical_warning || "Maintain situational awareness as wind vectors shift.";

        if (fuelTag) fuelTag.textContent = strat.fuel_class || "CLASS A WILDLAND";
        if (suppText) suppText.textContent = strat.primary_suppressant || "Class A Foam & Water Tenders";
        if (perimText) perimText.textContent = strat.containment_perimeter || "5.0 km Standoff Perimeter";
        if (ppeText) ppeText.textContent = strat.ppe_level || "NFPA Structural Bunker Gear + SCBA";
    }

    // ── Render Tactical Map Layers ───────────────────────────────────────────
    function renderMap(data) {
        if (!map) return;

        // Center map
        map.setView([currentLat, currentLon], getZoomLevel(currentRadiusKm));

        // Clear dynamic layers
        if (userMarker) map.removeLayer(userMarker);
        bufferCircles.forEach(c => map.removeLayer(c));
        bufferCircles = [];
        fireMarkersLayer.clearLayers();
        smokePlumeLayer.clearLayers();
        escapeVectorLayer.clearLayers();
        sheltersLayer.clearLayers();

        // 1. User pulsating beacon marker
        const userIcon = L.divIcon({
            className: "user-pulse-marker",
            html: `
                <div class="user-pulse-dot"></div>
                <div class="user-pulse-ring"></div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        userMarker = L.marker([currentLat, currentLon], {
            icon: userIcon,
            draggable: true,
            title: "Your Location (Drag to test another coordinate)"
        }).addTo(map);

        userMarker.bindPopup(`
            <div style="font-family:'Outfit',sans-serif; padding:4px;">
                <strong style="color:#38bdf8;">📍 Your Radar Position</strong><br>
                <span style="font-size:0.8rem; color:#cbd5e1;">${currentLocationLabel}</span><br>
                <span style="font-size:0.75rem; color:#94a3b8;">${currentLat.toFixed(4)}, ${currentLon.toFixed(4)}</span>
            </div>
        `);

        userMarker.on("dragend", (e) => {
            const pos = e.target.getLatLng();
            document.getElementById("input-lat").value = pos.lat.toFixed(4);
            document.getElementById("input-lon").value = pos.lng.toFixed(4);
            clearActivePresetChips();
            reverseGeocode(pos.lat, pos.lng);
            fetchProximityAlerts(pos.lat, pos.lng, currentRadiusKm, `Custom Location (${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)})`);
        });

        // 2. Threat Danger Rings
        // 10km Red Zone
        const dangerCircle = L.circle([currentLat, currentLon], {
            radius: 10000,
            color: "#ef4444",
            fillColor: "#ef4444",
            fillOpacity: 0.08,
            weight: 1.5,
            dashArray: "4, 6"
        }).addTo(map);
        bufferCircles.push(dangerCircle);

        // 25km Orange Zone
        const warningCircle = L.circle([currentLat, currentLon], {
            radius: 25000,
            color: "#f97316",
            fillColor: "#f97316",
            fillOpacity: 0.04,
            weight: 1,
            dashArray: "6, 8"
        }).addTo(map);
        bufferCircles.push(warningCircle);

        // Dynamic Outer Perimeter
        const outerCircle = L.circle([currentLat, currentLon], {
            radius: currentRadiusKm * 1000,
            color: "#38bdf8",
            fillColor: "#38bdf8",
            fillOpacity: 0.02,
            weight: 1
        }).addTo(map);
        bufferCircles.push(outerCircle);

        // 3. Projected Toxic Smoke Plume Cone (Polygon)
        if (data.smoke_plume && data.smoke_plume.plume_polygon && data.smoke_plume.plume_polygon.length > 2) {
            const plumePoly = L.polygon(data.smoke_plume.plume_polygon, {
                color: "#c084fc",
                fillColor: "#a855f7",
                fillOpacity: 0.16,
                weight: 1.5,
                dashArray: "4, 4"
            });
            plumePoly.bindTooltip("⚠️ Projected Toxic Smoke & Ember Plume Cone", { sticky: true });
            smokePlumeLayer.addLayer(plumePoly);
        }

        // 4. Safe Evacuation Corridor (Line & Arrow)
        if (data.closest_fire && data.escape_heading) {
            const headingRad = (data.escape_heading.degrees * Math.PI) / 180;
            const vectorDistKm = Math.min(Math.max(currentRadiusKm * 0.45, 14), 28);
            const dLat = (vectorDistKm / 111) * Math.cos(headingRad);
            const dLon = (vectorDistKm / (111 * Math.cos((currentLat * Math.PI) / 180))) * Math.sin(headingRad);

            const destLat = currentLat + dLat;
            const destLon = currentLon + dLon;

            const evacLine = L.polyline([[currentLat, currentLon], [destLat, destLon]], {
                color: "#10b981",
                weight: 4,
                dashArray: "8, 6",
                opacity: 0.95
            });
            escapeVectorLayer.addLayer(evacLine);

            const destIcon = L.divIcon({
                className: "escape-dest-marker",
                html: `
                    <div style="
                        background: #10b981; color: #fff; padding: 4px 10px; border-radius: 14px;
                        font-size: 0.72rem; font-weight: 700; font-family: 'Outfit';
                        box-shadow: 0 0 14px #10b981; white-space: nowrap; border: 1.5px solid #fff;
                    ">
                        SAFE ESCAPE CORRIDOR (${data.escape_heading.cardinal} ${data.escape_heading.degrees}°) ➔
                    </div>
                `,
                iconAnchor: [0, 12]
            });
            const destMarker = L.marker([destLat, destLon], { icon: destIcon });
            escapeVectorLayer.addLayer(destMarker);
        }

        // 5. Designated Assembly Shelters Layer
        (data.designated_shelters || []).forEach(sh => {
            if (!sh.latitude || !sh.longitude) return;
            const shelterIcon = L.divIcon({
                className: "shelter-map-icon",
                html: `
                    <div style="
                        width: 28px; height: 28px; border-radius: 50%;
                        background: #10b981; border: 2px solid #ffffff;
                        box-shadow: 0 0 12px #10b981;
                        display: flex; align-items: center; justify-content: center;
                        font-size: 14px; color: #fff;
                    ">🛡️</div>
                `,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });

            const shMarker = L.marker([sh.latitude, sh.longitude], { icon: shelterIcon });
            shMarker.bindPopup(`
                <div style="font-family:'Outfit',sans-serif; padding:4px; min-width:180px;">
                    <strong style="color:#10b981; font-size:0.9rem;">${sh.name}</strong><br>
                    <span style="font-size:0.75rem; color:#cbd5e1;">${sh.type}</span><br>
                    <span style="font-size:0.72rem; color:#94a3b8;">Distance: ${sh.distance_km} km (${sh.bearing_cardinal})</span><br>
                    <span style="font-size:0.72rem; color:#a7f3d0; font-weight:600;">${sh.capacity}</span>
                </div>
            `);
            sheltersLayer.addLayer(shMarker);
        });

        // 6. Nearby Fire Hotspots Markers
        (data.nearby_hotspots || []).forEach(f => {
            const isInd = f.classification.includes("Industrial");
            const color = isInd ? "#ef4444" : f.classification.includes("Forest") ? "#f97316" : "#facc15";
            const iconSymbol = isInd ? "🏭" : "🔥";

            const fireIcon = L.divIcon({
                className: "custom-fire-marker",
                html: `
                    <div style="
                        width: 28px; height: 28px; border-radius: 50%;
                        background: ${color}; box-shadow: 0 0 12px ${color};
                        display: flex; align-items: center; justify-content: center;
                        font-size: 14px; border: 2px solid #ffffff;
                    ">${iconSymbol}</div>
                `,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });

            const marker = L.marker([f.latitude, f.longitude], { icon: fireIcon });
            marker.bindPopup(`
                <div style="font-family:'Outfit',sans-serif; min-width: 190px;">
                    <div style="color:${color}; font-weight:700; font-size:0.9rem;">${f.classification}</div>
                    <div style="font-size:0.8rem; color:#e2e8f0; margin:3px 0;">${f.location_name}</div>
                    <div style="font-size:0.74rem; color:#94a3b8; line-height:1.4;">
                        Distance: <strong>${f.distance_km} km</strong> (${f.bearing_cardinal})<br>
                        Radiative Power: <strong>${f.frp} MW</strong><br>
                        Wind: ${f.wind_speed} km/h (${f.is_downwind ? "⚠️ Downwind Smoke Danger" : "Crosswind"})
                    </div>
                </div>
            `);
            fireMarkersLayer.addLayer(marker);
        });
    }

    function getZoomLevel(radiusKm) {
        if (radiusKm <= 15) return 12;
        if (radiusKm <= 35) return 11;
        if (radiusKm <= 60) return 10;
        return 9;
    }

    // ── Global City Search with Nominatim Autocomplete ───────────────────────
    function setupSearchInput() {
        const input = document.getElementById("global-search-input");
        const dropdown = document.getElementById("search-suggestions-dropdown");
        const clearBtn = document.getElementById("btn-clear-search");

        if (!input || !dropdown) return;

        input.addEventListener("input", (e) => {
            const query = e.target.value.trim();
            if (clearBtn) clearBtn.style.display = query.length > 0 ? "block" : "none";

            if (query.length < 3) {
                dropdown.style.display = "none";
                return;
            }

            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                fetchLocationSuggestions(query);
            }, 350);
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const query = input.value.trim();
                if (query) {
                    fetchLocationSuggestions(query, true);
                }
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener("click", (e) => {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = "none";
            }
        });
    }

    async function fetchLocationSuggestions(query, selectFirst = false) {
        const dropdown = document.getElementById("search-suggestions-dropdown");
        if (!dropdown) return;

        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
            if (!res.ok) return;
            const results = await res.json();

            if (!results || results.length === 0) {
                dropdown.innerHTML = `<div style="padding:10px; color:#64748b; font-size:0.75rem;">No locations found. Try city or coordinates.</div>`;
                dropdown.style.display = "flex";
                return;
            }

            if (selectFirst && results.length > 0) {
                selectSearchResult(results[0]);
                dropdown.style.display = "none";
                return;
            }

            dropdown.innerHTML = "";
            results.forEach(r => {
                const item = document.createElement("div");
                item.className = "search-suggestion-item";
                item.innerHTML = `<span>📍</span> <span>${escapeHtml(r.display_name)}</span>`;
                item.onclick = () => {
                    selectSearchResult(r);
                    dropdown.style.display = "none";
                };
                dropdown.appendChild(item);
            });
            dropdown.style.display = "flex";

        } catch (err) {
            console.warn("Geocoding lookup error:", err);
        }
    }

    function selectSearchResult(item) {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        document.getElementById("input-lat").value = lat.toFixed(4);
        document.getElementById("input-lon").value = lon.toFixed(4);
        document.getElementById("global-search-input").value = item.display_name;

        clearActivePresetChips();
        fetchProximityAlerts(lat, lon, currentRadiusKm, item.display_name);
    }

    window.clearSearch = function () {
        const input = document.getElementById("global-search-input");
        const clearBtn = document.getElementById("btn-clear-search");
        const dropdown = document.getElementById("search-suggestions-dropdown");
        if (input) input.value = "";
        if (clearBtn) clearBtn.style.display = "none";
        if (dropdown) dropdown.style.display = "none";
    };

    // ── Reverse Geocoding ────────────────────────────────────────────────────
    async function reverseGeocode(lat, lon) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.display_name) {
                    currentLocationLabel = data.display_name;
                    updateLocationBadge(lat, lon, data.display_name);
                }
            }
        } catch (e) {
            // silent ignore
        }
    }

    // ── GPS Geolocation ──────────────────────────────────────────────────────
    window.detectUserGPS = function () {
        const btnText = document.getElementById("gps-btn-text");
        if (btnText) btnText.textContent = "Acquiring GPS Fix...";

        if (!navigator.geolocation) {
            alert("Geolocation is not supported by your browser. Please enter coordinates manually.");
            if (btnText) btnText.textContent = "📍 Use My Current Location (GPS)";
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                document.getElementById("input-lat").value = lat.toFixed(4);
                document.getElementById("input-lon").value = lon.toFixed(4);
                if (btnText) btnText.textContent = "📍 GPS Location Acquired!";
                clearActivePresetChips();
                reverseGeocode(lat, lon);
                fetchProximityAlerts(lat, lon, currentRadiusKm, `My GPS Coordinates (${lat.toFixed(3)}, ${lon.toFixed(3)})`);
                setTimeout(() => {
                    if (btnText) btnText.textContent = "📍 Use My Current Location (GPS)";
                }, 3000);
            },
            (err) => {
                console.warn("GPS error:", err);
                alert(`GPS acquisition failed: ${err.message}. Defaulting to manual coordinate inputs.`);
                if (btnText) btnText.textContent = "📍 Use My Current Location (GPS)";
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    };

    window.loadPreset = function (lat, lon, name) {
        document.getElementById("input-lat").value = lat.toFixed(4);
        document.getElementById("input-lon").value = lon.toFixed(4);

        const pills = document.querySelectorAll(".preset-pill");
        pills.forEach(p => {
            if (p.textContent.includes(name.split(" ")[0])) {
                p.classList.add("active");
            } else {
                p.classList.remove("active");
            }
        });

        fetchProximityAlerts(lat, lon, currentRadiusKm, name);
    };

    window.handleCoordChange = function () {
        const lat = parseFloat(document.getElementById("input-lat").value);
        const lon = parseFloat(document.getElementById("input-lon").value);
        if (isNaN(lat) || isNaN(lon)) return;
        clearActivePresetChips();
        reverseGeocode(lat, lon);
        fetchProximityAlerts(lat, lon, currentRadiusKm, `Coordinates (${lat.toFixed(3)}, ${lon.toFixed(3)})`);
    };

    window.updateRadius = function (val) {
        currentRadiusKm = parseInt(val, 10);
        const tag = document.getElementById("radius-val");
        if (tag) tag.textContent = `${currentRadiusKm} km`;
        fetchProximityAlerts(currentLat, currentLon, currentRadiusKm, currentLocationLabel);
    };

    function clearActivePresetChips() {
        document.querySelectorAll(".preset-pill").forEach(p => p.classList.remove("active"));
    }

    function updateLocationBadge(lat, lon, label) {
        const text = document.getElementById("resolved-location-text");
        if (text) {
            text.textContent = `${label} (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
        }
    }

    // ── Tab Switcher: Civilian vs Responder ──────────────────────────────────
    window.switchPortalTab = function (mode) {
        activeTab = mode;
        const btnCivilian = document.getElementById("btn-mode-civilian");
        const btnResponder = document.getElementById("btn-mode-responder");
        const tabCivilian = document.getElementById("tab-civilian-content");
        const tabResponder = document.getElementById("tab-responder-content");
        const drawerTitle = document.getElementById("drawer-header-title");
        const drawerIcon = document.getElementById("drawer-header-icon");
        const dockTitle = document.getElementById("dock-btn-title");

        if (mode === "civilian") {
            btnCivilian.classList.add("active");
            btnResponder.classList.remove("active");
            tabCivilian.style.display = "block";
            tabResponder.style.display = "none";
            if (drawerTitle) drawerTitle.textContent = "Civilian Evacuation Steps & Nearest Assembly Shelters";
            if (drawerIcon) drawerIcon.textContent = "📋";
            if (dockTitle) dockTitle.textContent = "📋 Evacuation Checklist & Shelters";
        } else {
            btnResponder.classList.add("active");
            btnCivilian.classList.remove("active");
            tabResponder.style.display = "block";
            tabCivilian.style.display = "none";
            if (drawerTitle) drawerTitle.textContent = "Incident Commander Suppression Hydraulics & Chemical Tactics";
            if (drawerIcon) drawerIcon.textContent = "🚒";
            if (dockTitle) dockTitle.textContent = "🚒 Incident Command Hydraulics & Tactics";
        }
    };

    // ── Bottom Action Drawer Toggle ──────────────────────────────────────────
    window.toggleActionDrawer = function (explicitState) {
        const drawer = document.getElementById("action-drawer");
        const chevron = document.getElementById("dock-chevron-icon");
        if (!drawer) return;

        isDrawerOpen = explicitState !== undefined ? explicitState : !isDrawerOpen;
        if (isDrawerOpen) {
            drawer.classList.add("open");
            if (chevron) chevron.style.transform = "rotate(180deg)";
        } else {
            drawer.classList.remove("open");
            if (chevron) chevron.style.transform = "rotate(0deg)";
        }
    };

    // ── Emergency Sound Controller (Stop / Resume) ───────────────────────────
    window.toggleSirenSound = function () {
        EmergencySoundSystem.ensureAudioContext();
        if (EmergencySoundSystem.currentMode !== "SILENT") {
            // Actively sounding hooter or beep -> User clicked to STOP
            EmergencySoundSystem.stopAll(true);
        } else {
            // Sound is stopped or safe -> User clicked to resume / test
            if (currentAlertData) {
                EmergencySoundSystem.unmuteAndReevaluate(currentAlertData);
            } else {
                EmergencySoundSystem.playCriticalHooter();
            }
        }
    };

    window.dismissBanner = function () {
        const banner = document.getElementById("critical-alert-banner");
        if (banner) banner.style.display = "none";
    };

    // ── SOS Broadcast Handlers ───────────────────────────────────────────────
    window.sendWhatsAppSOS = function () {
        if (!currentAlertData) return;
        const d = currentAlertData;
        const closest = d.closest_fire;
        const msg = encodeURIComponent(
            `🚨 *EMERGENCY SOS: SATELLITE FIRE ALERT* 🚨\n\n` +
            `📍 *My Location:* ${currentLocationLabel}\n` +
            `🗺️ *Coordinates:* https://maps.google.com/?q=${currentLat},${currentLon}\n` +
            `🔥 *Hazard:* ${closest ? closest.classification : "Active Fire"} (${closest ? closest.distance_km : 0} km away)\n` +
            `🧭 *Safe Escape Heading:* ${d.escape_heading ? `${d.escape_heading.degrees}° ${d.escape_heading.cardinal}` : "Away from sector"}\n` +
            `🛡️ *Status:* ${d.threat_level}\n\n` +
            `_Automated emergency broadcast generated via SIH26162 Satellite AI._`
        );
        window.open(`https://api.whatsapp.com/send?text=${msg}`, "_blank");
    };

    window.sendSmsSOS = function () {
        if (!currentAlertData) return;
        const d = currentAlertData;
        const closest = d.closest_fire;
        const body = encodeURIComponent(
            `EMERGENCY SOS: Fire threat ${closest ? closest.distance_km : 0}km from my coordinates (${currentLat},${currentLon}). Evacuating along heading ${d.escape_heading ? d.escape_heading.degrees : 0}deg. Need assistance.`
        );
        window.open(`sms:?body=${body}`, "_self");
    };

    function setupClock() {
        function updateTime() {
            const el = document.getElementById("current-time");
            if (el) {
                const now = new Date();
                el.textContent = `${now.toUTCString().slice(17, 25)} UTC · Live VIIRS Feed`;
            }
        }
        setInterval(updateTime, 1000);
        updateTime();
    }

    // ── Math Helpers ─────────────────────────────────────────────────────────
    function haversine(lat1, lon1, lat2, lon2) {
        const R = 6371.0;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function calculateBearing(lat1, lon1, lat2, lon2) {
        const lat1Rad = (lat1 * Math.PI) / 180;
        const lat2Rad = (lat2 * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const y = Math.sin(dLon) * Math.cos(lat2Rad);
        const x =
            Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
        const brng = (Math.atan2(y, x) * 180) / Math.PI;
        return Math.round((brng + 360) % 360);
    }

    function getCardinal(deg) {
        const cardinals = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
        const idx = Math.floor((deg + 11.25) / 22.5) % 16;
        return cardinals[idx];
    }

    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

})();
