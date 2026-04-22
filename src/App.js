import {
  MapContainer,
  Polygon,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "leaflet-polylinedecorator";
import axios from "axios";
import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import slots from "./data/TKD_Whole_Yard_Slot_Mapping_Data.json";

/* ================================================================
   POINT-IN-POLYGON  (ray-casting for lat/lng quads)
   ================================================================ */
const pointInPolygon = (lat, lng, slot) => {
  const poly = [slot.latlng1, slot.latlng2, slot.latlng3, slot.latlng4];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat;
    const xj = poly[j].lng, yj = poly[j].lat;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

const findSlot = (lat, lng) => {
  const f = parseFloat;
  for (const slot of slots) {
    if (pointInPolygon(f(lat), f(lng), slot)) return slot.name;
  }
  return null;
};

const findSlotObj = (lat, lng) => {
  const f = parseFloat;
  for (const slot of slots) {
    if (pointInPolygon(f(lat), f(lng), slot)) return slot;
  }
  return null;
};

/* Returns the display color for a slot name */
const slotNameColor = (name) =>
  name === "T-PATH" ? "#38bdf8" : "#d97706";

/* ================================================================
   HAVERSINE
   ================================================================ */
function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/* ================================================================
   ZOOM HELPERS
   ================================================================ */
const ZoomToSlot = ({ slot }) => {
  const map = useMap();
  useEffect(() => {
    if (!slot) return;
    const bounds = L.latLngBounds([
      [slot.latlng1.lat, slot.latlng1.lng],
      [slot.latlng2.lat, slot.latlng2.lng],
      [slot.latlng3.lat, slot.latlng3.lng],
      [slot.latlng4.lat, slot.latlng4.lng],
    ]);
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [slot]);
  return null;
};

const ZoomToLatLng = ({ position }) => {
  const map = useMap();
  useEffect(() => {
    if (!position) return;
    map.setView(position, 20);
  }, [position]);
  return null;
};

/* ================================================================
   SMOOTH LIVE TRUCK MARKER
   ================================================================ */
const LiveTruckMarker = ({ position }) => {
  const map = useMap();
  const markerRef = useRef(null);
  const prevPosRef = useRef(null);
  const animFrameRef = useRef(null);

  const truckIcon = L.divIcon({
    html: `<div style="width:12px;height:12px;background:	#FFBF00;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 3px rgba(192, 102, 29, 0.35);"></div>`,
    className: "",
    iconAnchor: [6, 6],
    iconSize: [12, 12],
  });

  useEffect(() => {
    if (!position) return;

    if (!markerRef.current) {
      markerRef.current = L.marker([position.lat, position.lng], { icon: truckIcon, zIndexOffset: 9999 }).addTo(map);
      prevPosRef.current = position;
      return;
    }

    const from = prevPosRef.current || position;
    const to = position;
    const steps = 40;
    let step = 0;

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const animate = () => {
      step++;
      const t = step / steps;
      const lat = from.lat + (to.lat - from.lat) * t;
      const lng = from.lng + (to.lng - from.lng) * t;
      markerRef.current.setLatLng([lat, lng]);
      if (step < steps) animFrameRef.current = requestAnimationFrame(animate);
      else prevPosRef.current = to;
    };

    animFrameRef.current = requestAnimationFrame(animate);
  }, [position]);

  useEffect(() => {
    return () => {
      if (markerRef.current) map.removeLayer(markerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  return null;
};

/* ================================================================
   ICONS
   ================================================================ */
const createStartIcon = () =>
  L.divIcon({
    html: `<div style="width:38px;height:38px;background:#16a34a;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 12px rgba(22,163,74,0.55);display:flex;align-items:center;justify-content:center;font-size:17px;">🚀</div>`,
    className: "",
    iconAnchor: [19, 19],
    iconSize: [38, 38],
  });

const createEndIcon = () =>
  L.divIcon({
    html: `<div style="width:38px;height:38px;background:#dc2626;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 12px rgba(220,38,38,0.55);display:flex;align-items:center;justify-content:center;font-size:17px;">🏁</div>`,
    className: "",
    iconAnchor: [19, 19],
    iconSize: [38, 38],
  });

const createStopIcon = (label, active) =>
  L.divIcon({
    html: `<div style="width:28px;height:28px;background:${active ? "#0f172a" : "#f97316"};border:2.5px solid #fff;border-radius:50%;box-shadow:0 1px 8px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:11px;font-family:monospace;">${label}</div>`,
    className: "",
    iconAnchor: [14, 14],
    iconSize: [28, 28],
  });

/* ================================================================
   ARROW DECORATOR
   ================================================================ */
const ArrowDecorator = ({ positions }) => {
  const map = useMap();
  useEffect(() => {
    if (positions.length < 2) return;
    const poly = L.polyline(positions, { opacity: 0 }).addTo(map);
    const dec = L.polylineDecorator(poly, {
      patterns: [{
        offset: "15%", repeat: "90px",
        symbol: L.Symbol.arrowHead({
          pixelSize: 13, polygon: true,
          pathOptions: { color: "#f97316", fillColor: "#f97316", fillOpacity: 1, weight: 0 },
        }),
      }],
    }).addTo(map);
    return () => { map.removeLayer(poly); map.removeLayer(dec); };
  }, [positions]);
  return null;
};

/* ================================================================
   FIT BOUNDS
   ================================================================ */
const FitBounds = ({ positions }) => {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1)
      map.fitBounds(L.latLngBounds(positions), { padding: [50, 50] });
    else if (positions.length === 1)
      map.setView(positions[0], 20);
  }, [positions]);
  return null;
};

/* ================================================================
   DETAIL DRAWER
   ================================================================ */
const DetailDrawer = ({ point, index, total, onClose }) => {
  if (!point) return null;

  const slotObj = findSlotObj(point.LATITUDE, point.LONGITUDE);
  const slotName = slotObj?.name || null;
  const blockName = slotObj?.blockName || null;

  const isStart = index === 0;
  const isEnd = index === total - 1;
  const badgeColor = isStart ? "#16a34a" : isEnd ? "#dc2626" : "#f97316";
  const badgeLabel = isStart ? "START POINT" : isEnd ? "END POINT" : `STOP ${index}`;

  const rows = [
    { icon: "📦", label: "Container No", value: point.CONTAINERNO },
    { icon: "🏗️", label: "Equipment ID", value: point.EQUIPMENTID },
    { icon: "🕐", label: "Date / Time", value: point.DATETIME?.replace("T", "  ") },
    { icon: "📍", label: "Latitude", value: parseFloat(point.LATITUDE).toFixed(6) },
    { icon: "📍", label: "Longitude", value: parseFloat(point.LONGITUDE).toFixed(6) },
    { icon: "⛰️", label: "Altitude", value: `${point.ALTITUDE} m` },
    { icon: "📶", label: "Status", value: point.STATUS === "1" ? "Active ✓" : "Inactive" },
    { icon: "🔢", label: "Package Type", value: point.PACKAGETYPE },
    { icon: "🆔", label: "Record ID", value: `#${point.ID}` },
  ];

  return (
    <div style={{
      position: "absolute",
      top: 12, right: 12, bottom: 12,
      width: 292,
      zIndex: 2000,
      background: "#fff",
      borderRadius: 14,
      boxShadow: "0 8px 40px rgba(0,0,0,0.15)",
      border: "1px solid #e5e7eb",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'DM Mono', monospace",
      animation: "slideIn .18s ease",
      overflow: "hidden",
    }}>
      <div style={{ background: badgeColor, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 9, letterSpacing: 2, textTransform: "uppercase" }}>
            Point {index + 1} of {total}
          </div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 14, letterSpacing: 1, marginTop: 3 }}>
            {badgeLabel}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 8,
          color: "#fff", fontSize: 20, width: 32, height: 32,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}>×</button>
      </div>

      {/* Slot + Block highlight */}
      <div style={{
        margin: "12px 14px 0",
        background: slotName ? "#f0fdf4" : "#fafafa",
        border: `1px solid ${slotName ? "#bbf7d0" : "#e5e7eb"}`,
        borderRadius: 9,
        padding: "9px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <span style={{ fontSize: 20 }}>{slotName ? "🅿️" : "❓"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: slotName ? "#16a34a" : "#9ca3af", letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>
            Slot Position
          </div>
          {/* Slot NAME — light blue for T-PATH, amber otherwise */}
          <div style={{ fontWeight: 800, fontSize: slotName ? 18 : 12, color: slotName ? slotNameColor(slotName) : "#9ca3af", letterSpacing: 1 }}>
            {slotName || "Not in any slot"}
          </div>
          {/* Block name shown below slot name */}
          {blockName && (
            <div style={{
              marginTop: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 6,
              padding: "2px 8px",
            }}>
              <span style={{ fontSize: 9, color: "#3b82f6", letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>Block</span>
              <span style={{ fontWeight: 800, fontSize: 13, color: "#1d4ed8", letterSpacing: 1 }}>{blockName}</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0 4px" }}>
        {rows.map(row => (
          <div key={row.label} style={{
            display: "flex", alignItems: "center",
            padding: "7px 14px",
            borderBottom: "1px solid #f3f4f6",
            gap: 10,
          }}>
            <span style={{ fontSize: 14, width: 20, textAlign: "center", flexShrink: 0 }}>{row.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>{row.label}</div>
              <div style={{ fontSize: 12, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.value}</div>
            </div>
          </div>
        ))}
      </div>

      <style>{`@keyframes slideIn { from { opacity:0; transform:translateX(18px); } to { opacity:1; transform:translateX(0); } }`}</style>
    </div>
  );
};

/* ================================================================
   TIMELINE SIDEBAR
   ================================================================ */
const TimelinePanel = ({ locations, activeIndex, onSelect }) => {
  if (!locations.length) return null;
  return (
    <div style={{
      position: "absolute",
      top: 12, left: 12,
      zIndex: 1000,
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: 12,
      boxShadow: "0 4px 24px rgba(0,0,0,0.10)",
      width: 220,
      maxHeight: "calc(100% - 24px)",
      overflowY: "auto",
      fontFamily: "'DM Mono', monospace",
    }}>
      <div style={{
        padding: "11px 14px 8px",
        borderBottom: "1px solid #f3f4f6",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontWeight: 700, fontSize: 11, color: "#111", letterSpacing: 1, textTransform: "uppercase" }}>
          📦 Movement Log
        </span>
        <span style={{ fontSize: 9, color: "#9ca3af", background: "#f3f4f6", padding: "2px 6px", borderRadius: 6 }}>
          {locations.length} pts
        </span>
      </div>

      {locations.slice().reverse().map((loc, i) => {
        const originalIndex = locations.length - 1 - i;
        const isStart = originalIndex === 0;
        const isEnd = originalIndex === locations.length - 1;
        const isActive = originalIndex === activeIndex;
        const dotColor = isStart ? "#16a34a" : isEnd ? "#dc2626" : "#f97316";
        const slotObj = findSlotObj(loc.LATITUDE, loc.LONGITUDE);
        const slotName = slotObj?.name;
        const blockName = slotObj?.blockName;

        return (
          <div
            key={originalIndex}
            onClick={() => onSelect(originalIndex)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 9,
              padding: "8px 12px",
              borderBottom: "1px solid #f9fafb",
              cursor: "pointer",
              background: isActive ? "#fff7ed" : "transparent",
              borderLeft: `3px solid ${isActive ? "#f97316" : "transparent"}`,
              transition: "all .12s",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 2 }}>
              <div style={{
                width: 20, height: 20, borderRadius: "50%", background: dotColor, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, fontWeight: 800, flexShrink: 0,
              }}>
                {isStart ? "S" : isEnd ? "E" : originalIndex}
              </div>
              {originalIndex > 0 && (
                <div style={{ width: 2, height: 18, background: "#e5e7eb", margin: "2px 0" }} />
              )}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 2 }}>{loc.DATETIME}</div>
              {slotName && (
                <div style={{
                  fontSize: 10, fontWeight: 700,
                  color: slotNameColor(slotName),
                  background: slotName === "T-PATH" ? "#e0f2fe" : "#fffbeb",
                  padding: "1px 5px", borderRadius: 4,
                  display: "inline-block", marginBottom: 2,
                }}>
                  {slotName}
                </div>
              )}
              {blockName && (
                <div style={{
                  fontSize: 9, fontWeight: 700,
                  color: "#1d4ed8",
                  background: "#eff6ff",
                  padding: "1px 5px", borderRadius: 4,
                  display: "inline-block", marginBottom: 2, marginLeft: 3,
                }}>
                  {blockName}
                </div>
              )}
              <div style={{ fontSize: 9, color: "#6b7280" }}>
                {parseFloat(loc.LATITUDE).toFixed(4)}, {parseFloat(loc.LONGITUDE).toFixed(4)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ================================================================
   LIVE TRUCK STATUS CHIP (top-right overlay)
   ================================================================ */
const LiveStatusChip = ({ connected, speed, livePosition }) => {
  if (!connected && !livePosition) return null;
  return (
    <div style={{
      position: "absolute",
      top: 12, right: 12,
      zIndex: 1500,
      background: connected ? "#0f172a" : "#6b7280",
      border: `1.5px solid ${connected ? "#00d4ff" : "#4b5563"}`,
      borderRadius: 10,
      padding: "8px 14px",
      fontFamily: "'DM Mono', monospace",
      display: "flex", alignItems: "center", gap: 10,
      boxShadow: connected ? "0 0 18px rgba(0,212,255,0.25)" : "none",
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: connected ? "#00d4ff" : "#6b7280",
        boxShadow: connected ? "0 0 6px #00d4ff" : "none",
        animation: connected ? "livePulse 1.2s ease-in-out infinite" : "none",
      }} />
      <div>
        <div style={{ fontSize: 8, color: connected ? "#00d4ff" : "#9ca3af", letterSpacing: 2, textTransform: "uppercase" }}>
          {connected ? "Live Truck" : "Offline"}
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{speed} km/h</div>
      </div>
      <style>{`@keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
};

/* ================================================================
   MAIN PAGE
   ================================================================ */
const MapPage = () => {
  const [containerNo, setContainerNo] = useState("");
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(null);
  const [latLongInput, setLatLongInput] = useState("");
  const [searchedPosition, setSearchedPosition] = useState(null);
  const [searchBlock, setSearchBlock] = useState("");
  const [highlightedSlot, setHighlightedSlot] = useState(null);

  // Live truck state
  const [livePosition, setLivePosition] = useState(null);
  const [livePath, setLivePath] = useState([]);
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [liveConnected, setLiveConnected] = useState(false);
  const lastPosRef = useRef(null);
  const lastTimeRef = useRef(null);

  const center = [28.5094, 77.2908];

  // Socket connection for live truck
  useEffect(() => {
    const socket = io("http://14.96.226.166:3002");

    socket.on("connect", () => {
      setLiveConnected(true);
      console.log("Live socket connected");
    });

    socket.on("disconnect", () => {
      setLiveConnected(false);
      console.log("Live socket disconnected");
    });

    socket.on("gnss", (data) => {
      console.log("Received GNSS data:", data);
      if (!data.lat || !data.lon) return;
      const newPos = { lat: data.lat, lng: data.lon };
      const now = Date.now();

      if (lastTimeRef.current && lastPosRef.current) {
        const elapsed = now - lastTimeRef.current;
        const moved = haversine(lastPosRef.current, newPos);
        if (elapsed < 500 && moved < 0.5) return;
      }

      if (lastPosRef.current && lastTimeRef.current) {
        const dist = haversine(lastPosRef.current, newPos);
        const dt = (now - lastTimeRef.current) / 1000;
        const spd = dt > 0 ? (dist / dt) * 3.6 : 0;
        setLiveSpeed(Math.round(spd));
      }

      lastPosRef.current = newPos;
      lastTimeRef.current = now;

      setLivePath((prev) => [...prev.slice(-500), [newPos.lat, newPos.lng]]);
      setLivePosition(newPos);
    });

    return () => socket.disconnect();
  }, []);

  const handleLatLongSearch = () => {
    if (!latLongInput.trim()) return;
    const parts = latLongInput.split(",");
    if (parts.length !== 2) { alert("Enter in format: lat,long"); return; }
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) { alert("Invalid coordinates"); return; }
    setSearchedPosition([lat, lng]);
  };

  const handleSearchBlock = () => {
    if (!searchBlock.trim()) return;
    const found = slots.find((s) => s.name.toLowerCase() === searchBlock.toLowerCase());
    if (!found) { alert("Block not found"); return; }
    setHighlightedSlot(found);
  };

  const fetchData = async () => {
    if (!containerNo.trim()) return;
    setLoading(true);
    setError("");
    setActiveIndex(null);
    try {
      const res = await axios.get(`http://localhost:5000/api/getlocation?container=${containerNo}`);
      const data = res.data.data || [];
      setLocations(data.reverse());
      if (!data.length) setError("No locations found.");
    } catch {
      setError("Failed to fetch. Check connection.");
    } finally {
      setLoading(false);
    }
  };

  const pathPositions = locations.map((loc) => [parseFloat(loc.LATITUDE), parseFloat(loc.LONGITUDE)]);
  const activePoint = activeIndex !== null ? locations[activeIndex] : null;

  return (
    <div style={{
      fontFamily: "'DM Mono', 'Courier New', monospace",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* ===== HEADER ===== */}
      <div style={{
        padding: "11px 20px",
        background: "#fff",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        gap: 14,
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        zIndex: 1100,
        flexShrink: 0,
        flexWrap: "wrap",
      }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a", letterSpacing: 2, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ background: "#0f172a", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11 }}>SUNIC</span>
          TRACK
        </div>

        <div style={{ width: 1, height: 22, background: "#e5e7eb" }} />

        <div style={{ width: 1, height: 22, background: "#e5e7eb" }} />

        <input
          type="text"
          placeholder="SEARCH BLOCK NAME"
          value={searchBlock}
          onChange={(e) => setSearchBlock(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && handleSearchBlock()}
          style={{
            padding: "7px 13px", width: 200,
            border: "1.5px solid #e5e7eb", borderRadius: 8,
            fontSize: 12, fontFamily: "inherit", letterSpacing: 1,
            outline: "none", background: "#f8fafc",
          }}
        />

        <button
          onClick={handleSearchBlock}
          style={{
            padding: "7px 14px", background: "#f97316", color: "#fff",
            border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}
        >
          SEARCH
        </button>

        <input
          type="text"
          placeholder="LAT,LONG (e.g. 28.50,77.29)"
          value={latLongInput}
          onChange={(e) => setLatLongInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLatLongSearch()}
          style={{
            padding: "7px 13px", width: 220,
            border: "1.5px solid #e5e7eb", borderRadius: 8,
            fontSize: 12, background: "#f8fafc",
          }}
        />

        <button
          onClick={handleLatLongSearch}
          style={{
            padding: "7px 14px", background: "#2563eb", color: "#fff",
            border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}
        >
          GO
        </button>

        {/* Live indicator in header */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: liveConnected ? "#0f172a" : "#f3f4f6",
            border: `1px solid ${liveConnected ? "#00d4ff" : "#e5e7eb"}`,
            borderRadius: 8, padding: "5px 10px",
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: liveConnected ? "#00d4ff" : "#9ca3af",
              boxShadow: liveConnected ? "0 0 5px #00d4ff" : "none",
            }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: liveConnected ? "#00d4ff" : "#9ca3af", letterSpacing: 1 }}>
              {liveConnected ? `LIVE · ${liveSpeed} KM/H` : "TRUCK OFFLINE"}
            </span>
          </div>
        </div>

        {error && <div style={{ fontSize: 11, color: "#dc2626", marginLeft: 6 }}>{error}</div>}
      </div>

      {/* ===== MAP ===== */}
      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer
          center={center}
          zoom={18}
          style={{ height: "100%", width: "100%", background: "#fff" }}
        >
          <ZoomToSlot slot={highlightedSlot} />
          <ZoomToLatLng position={searchedPosition} />

          {/* Live truck smooth marker */}
          <LiveTruckMarker position={livePosition} />

          {/* Live truck trail */}
          {livePath.length > 1 && (
            <Polyline
              positions={livePath}
              pathOptions={{
                color: "#00d4ff",
                weight: 3,
                opacity: 0.7,
                dashArray: "6 4",
              }}
            />
          )}

          {searchedPosition && (
            <Marker
              position={searchedPosition}
              icon={L.divIcon({
                html: "📍",
                className: "",
                iconSize: [20, 20],
                iconAnchor: [10, 20],
              })}
            >
              <Popup>
                <div style={{ fontFamily: "monospace" }}>
                  <b>Custom Location</b><br />
                  {searchedPosition[0].toFixed(6)}, {searchedPosition[1].toFixed(6)}
                  <br />
                  Slot: {findSlot(searchedPosition[0], searchedPosition[1]) || "None"}
                  <br />
                  Block: {findSlotObj(searchedPosition[0], searchedPosition[1])?.blockName || "None"}
                </div>
              </Popup>
            </Marker>
          )}

          {/* Slot polygons */}
          {slots.map((slot, index) => {
            const positions = [
              [slot.latlng1.lat, slot.latlng1.lng],
              [slot.latlng2.lat, slot.latlng2.lng],
              [slot.latlng3.lat, slot.latlng3.lng],
              [slot.latlng4.lat, slot.latlng4.lng],
            ];

            const isHighlighted =
              (activePoint &&
                pointInPolygon(parseFloat(activePoint.LATITUDE), parseFloat(activePoint.LONGITUDE), slot)) ||
              (highlightedSlot && highlightedSlot.name === slot.name);

            const isTPath = slot.name === "T-PATH";
            const isRST = slot.name === "RST";

            return (
              <Polygon
                key={index}
                positions={positions}
                pathOptions={{
                  color: isHighlighted ? "#16a34a" : isTPath ? "#38bdf8" : isRST ? "#fb923c" : "#cbd5e1",
                  weight: isHighlighted ? 2.5 : isTPath ? 2 : isRST ? 2 : 1.5,
                  fillColor: isHighlighted ? "#bbf7d0" : isTPath ? "#bae6fd" : isRST ? "#fed7aa" : "#f1f5f9",
                  fillOpacity: isHighlighted ? 0.65 : isTPath ? 0.55 : isRST ? 0.55 : 0.4,
                }}
              >
                <Popup>
                  <div style={{ fontFamily: "monospace", textAlign: "center", padding: "4px 2px" }}>
                    <div style={{ fontSize: 9, color: "#9ca3af", letterSpacing: 1 }}>SLOT</div>
                    {/* Slot name — light blue for T-PATH, amber otherwise */}
                    <div style={{ fontSize: 17, fontWeight: 800, color: slotNameColor(slot.name) }}>{slot.name}</div>
                    {/* Block name in blue if available */}
                    {slot.blockName && (
                      <div style={{
                        marginTop: 4,
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: 5,
                        padding: "2px 8px",
                        display: "inline-block",
                      }}>
                        <span style={{ fontSize: 8, color: "#3b82f6", letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>Block · </span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: "#1d4ed8" }}>{slot.blockName}</span>
                      </div>
                    )}
                  </div>
                </Popup>
              </Polygon>
            );
          })}

          {/* Glow trail for container path */}
          {pathPositions.length > 1 && (
            <Polyline positions={pathPositions}
              pathOptions={{ color: "#fed7aa", weight: 10, lineCap: "round", lineJoin: "round", opacity: 0.6 }}
            />
          )}

          {pathPositions.length > 1 && (
            <Polyline positions={pathPositions}
              pathOptions={{ color: "#f97316", weight: 2.5, dashArray: "7 5", lineCap: "round" }}
            />
          )}

          <ArrowDecorator positions={pathPositions} />
          <FitBounds positions={pathPositions} />

          {/* Intermediate stops */}
          {locations.map((loc, index) => {
            if (index === 0 || index === locations.length - 1) return null;
            const position = [parseFloat(loc.LATITUDE), parseFloat(loc.LONGITUDE)];
            return (
              <Marker
                key={index}
                position={position}
                icon={createStopIcon(index, activeIndex === index)}
                eventHandlers={{ click: () => setActiveIndex(index) }}
              />
            );
          })}

          {pathPositions.length > 0 && (
            <Marker position={pathPositions[0]} icon={createStartIcon()} eventHandlers={{ click: () => setActiveIndex(0) }} />
          )}

          {pathPositions.length > 1 && (
            <Marker position={pathPositions[pathPositions.length - 1]} icon={createEndIcon()} eventHandlers={{ click: () => setActiveIndex(locations.length - 1) }} />
          )}
        </MapContainer>

        {/* Overlays */}
        <TimelinePanel locations={locations} activeIndex={activeIndex} onSelect={setActiveIndex} />

        <DetailDrawer point={activePoint} index={activeIndex} total={locations.length} onClose={() => setActiveIndex(null)} />

        {/* Legend */}
        {!activePoint && locations.length > 0 && (
          <div style={{
            position: "absolute", bottom: 16, right: 16, zIndex: 1000,
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
            padding: "9px 14px", boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
            fontSize: 10, fontFamily: "monospace", display: "flex", gap: 14, alignItems: "center",
          }}>
            <span style={{ color: "#9ca3af", fontSize: 9, letterSpacing: 1 }}>CLICK MARKER FOR DETAILS</span>
            <div style={{ width: 1, height: 14, background: "#e5e7eb" }} />
            {[
              { color: "#16a34a", label: "Start" },
              { color: "#dc2626", label: "End" },
              { color: "#f97316", label: "Stop" },
              { color: "#00d4ff", label: "Live" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color }} />
                <span style={{ color: "#6b7280" }}>{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500;700&display=swap');
        .leaflet-container { background: #ffffff !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .leaflet-popup-content-wrapper { border-radius: 10px !important; font-family: 'DM Mono', monospace !important; box-shadow: 0 4px 20px rgba(0,0,0,0.12) !important; }
        .leaflet-popup-tip { display: none; }
      `}</style>
    </div>
  );
};

export default MapPage;