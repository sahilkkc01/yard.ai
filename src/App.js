import {
  MapContainer,
  Polygon,
  Marker,
  Popup,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import axios from "axios";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { io } from "socket.io-client";
import rawSlots from "./data/TKD_Whole_Yard_Slot_Mapping_Data.json";

const slots = Array.isArray(rawSlots)
  ? rawSlots
  : rawSlots.data || rawSlots.slots || rawSlots.features || [];

/* ================================================================
   POINT-IN-POLYGON (ray-casting)
   ================================================================ */
/* ================================================================
   POINT-IN-POLYGON (NEW JSON FORMAT)
================================================================ */

const pointInPolygon = (lat, lng, slot) => {
  const poly = slot.polygon;

  if (!Array.isArray(poly) || poly.length < 3) return false;

  let inside = false;

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0];
    const xi = poly[i][1];

    const yj = poly[j][0];
    const xj = poly[j][1];

    const intersect =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
};

const findSlotObj = (lat, lng) => {
  const f = parseFloat;

  for (const slot of slots) {
    if (pointInPolygon(f(lat), f(lng), slot)) {
      return slot;
    }
  }

  return null;
};

const findSlot = (lat, lng) => findSlotObj(lat, lng)?.id || null;

const slotNameColor = (id) =>
  id === "T-PATH"
    ? "#38bdf8"
    : id === "RST"
    ? "#fb923c"
    : "#f59e0b";

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
   VIEWPORT-AWARE SLOT RENDERER — only renders visible slots
   ================================================================ */
const ViewportSlots = ({ activePoint, highlightedSlot }) => {
  const map = useMap();
  const [bounds, setBounds] = useState(null);
  const [clickedSlot, setClickedSlot] = useState(null);

  useMapEvents({
    moveend: () => setBounds(map.getBounds()),
    zoomend: () => setBounds(map.getBounds()),
  });

  useEffect(() => {
    setBounds(map.getBounds());
  }, [map]);

  const visibleSlots = useMemo(() => {
    if (!bounds) return [];

    return slots.filter((slot) => {
      const polygon = slot.polygon;

      if (!Array.isArray(polygon) || polygon.length < 3) {
        return false;
      }

      const lats = polygon.map((p) => Number(p[0]));
      const lngs = polygon.map((p) => Number(p[1]));

      return bounds.intersects(
        L.latLngBounds(
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)]
        )
      );
    });
  }, [bounds]);

  return (
    <>
      {visibleSlots.map((slot, index) => {
        const slotId = slot.id || slot.ID || slot.name || "NO ID";

        const positions = slot.polygon.map((point) => [
          Number(point[0]),
          Number(point[1]),
        ]);

        const isHighlighted =
          highlightedSlot?.id === slot.id ||
          clickedSlot?.id === slot.id ||
          (activePoint &&
            pointInPolygon(
              parseFloat(activePoint.LATITUDE),
              parseFloat(activePoint.LONGITUDE),
              slot
            ));

        return (
          <Polygon
            key={`${slotId}-${index}`}
            positions={positions}
            eventHandlers={{
              click: (e) => {
                console.log("FULL CLICKED SLOT:", slot);
                console.log("CLICKED SLOT ID:", slotId);

                setClickedSlot(slot);

                // Force popup open
                e.target.openPopup();
              },
            }}
            pathOptions={{
              color: isHighlighted ? "#16a34a" : "#64748b",
              weight: isHighlighted ? 3 : 1.5,
              fillColor: isHighlighted ? "#86efac" : "#f1f5f9",
              fillOpacity: isHighlighted ? 0.7 : 0.45,
            }}
          >
            <Popup>
              <div
                style={{
                  minWidth: 180,
                  padding: 10,
                  textAlign: "center",
                  fontFamily: "monospace",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "#64748b",
                    marginBottom: 8,
                  }}
                >
                  CLICKED SLOT
                </div>

                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: "#f97316",
                  }}
                >
                  {slotId}
                </div>
              </div>
            </Popup>
          </Polygon>
        );
      })}
    </>
  );
};

/* ================================================================
   ZOOM HELPERS
   ================================================================ */
const ZoomToSlot = ({ slot }) => {
  const map = useMap();

  useEffect(() => {
    if (!slot?.polygon?.length) return;

    map.fitBounds(
      L.latLngBounds(slot.polygon),
      {
        padding: [50, 50],
      }
    );
  }, [slot, map]);

  return null;
};

const ZoomToLatLng = ({ position }) => {
  const map = useMap();
  useEffect(() => {
    if (!position) return;
    map.setView(position, 20);
  }, [position, map]);
  return null;
};

const FitBounds = ({ positions }) => {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1)
      map.fitBounds(L.latLngBounds(positions), { padding: [50, 50] });
    else if (positions.length === 1)
      map.setView(positions[0], 20);
  }, [positions, map]);
  return null;
};

/* ================================================================
   LIVE TRUCK MARKER — lightweight, CSS transition based
   ================================================================ */
const LiveTruckMarker = ({ position }) => {
  const map = useMap();
  const markerRef = useRef(null);

  const icon = useMemo(
    () =>
      L.divIcon({
        html: `<div style="width:14px;height:14px;background:#FFBF00;border:2.5px solid #fff;border-radius:50%;box-shadow:0 0 0 4px rgba(255,191,0,0.3);"></div>`,
        className: "",
        iconAnchor: [7, 7],
        iconSize: [14, 14],
      }),
    []
  );

  useEffect(() => {
    if (!position) return;
    if (!markerRef.current) {
      markerRef.current = L.marker([position.lat, position.lng], { icon, zIndexOffset: 9999 }).addTo(map);
    } else {
      markerRef.current.setLatLng([position.lat, position.lng]);
    }
  }, [position, map, icon]);

  useEffect(() => {
    return () => {
      if (markerRef.current) map.removeLayer(markerRef.current);
    };
  }, [map]);

  return null;
};

/* ================================================================
   ICONS
   ================================================================ */
const startIcon = L.divIcon({
  html: `<div style="width:30px;height:30px;background:#16a34a;border:2.5px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(22,163,74,0.5);display:flex;align-items:center;justify-content:center;font-size:14px;">🚀</div>`,
  className: "", iconAnchor: [15, 15], iconSize: [30, 30],
});

const endIcon = L.divIcon({
  html: `<div style="width:30px;height:30px;background:#dc2626;border:2.5px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(220,38,38,0.5);display:flex;align-items:center;justify-content:center;font-size:14px;">🏁</div>`,
  className: "", iconAnchor: [15, 15], iconSize: [30, 30],
});

const makeStopIcon = (label, active) =>
  L.divIcon({
    html: `<div style="width:24px;height:24px;background:${active ? "#0f172a" : "#f97316"};border:2px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:9px;font-family:monospace;">${label}</div>`,
    className: "", iconAnchor: [12, 12], iconSize: [24, 24],
  });

/* ================================================================
   LIVE SLOT HUD — floating chip that shows current slot
   ================================================================ */
const LiveSlotHUD = ({ position, speed, connected }) => {
  const slotObj = position
    ? findSlotObj(position.lat, position.lng)
    : null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#0f172a",
        border: `1.5px solid ${connected ? "#00d4ff" : "#334155"}`,
        borderRadius: 50,
        padding: "7px 16px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        fontFamily: "monospace",
        pointerEvents: "none",
        minWidth: 180,
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: connected ? "#00d4ff" : "#475569",
          boxShadow: connected ? "0 0 6px #00d4ff" : "none",
          flexShrink: 0,
        }}
      />

      {connected && slotObj ? (
        <>
          <span
            style={{
              fontSize: 9,
              color: "#64748b",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            SLOT
          </span>

          <span
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: slotNameColor(slotObj.id),
              letterSpacing: 1,
            }}
          >
            {slotObj.id}
          </span>

          <span
            style={{
              fontSize: 9,
              color: "#475569",
              marginLeft: 4,
            }}
          >
            {speed} km/h
          </span>
        </>
      ) : (
        <span
          style={{
            fontSize: 10,
            color: connected ? "#94a3b8" : "#475569",
            letterSpacing: 1,
          }}
        >
          {connected ? "OUTSIDE SLOTS" : "TRUCK OFFLINE"}
        </span>
      )}
    </div>
  );
};

/* ================================================================
   COMPACT TIMELINE (bottom sheet on mobile)
   ================================================================ */
const TimelinePanel = ({ locations, activeIndex, onSelect, open, onToggle }) => {
  if (!locations.length) return null;

  return (
    <div style={{
      position: "absolute",
      top: 12, left: 12,
      zIndex: 1000,
      fontFamily: "monospace",
    }}>
      <button
        onClick={onToggle}
        style={{
          background: "#0f172a",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "6px 12px",
          fontSize: 10,
          fontWeight: 700,
          cursor: "pointer",
          letterSpacing: 1,
          display: "flex",
          alignItems: "center",
          gap: 6,
          boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
        }}
      >
        📦 {locations.length} PTS {open ? "▲" : "▼"}
      </button>

      {open && (
        <div style={{
          marginTop: 6,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          width: 200,
          maxHeight: 280,
          overflowY: "auto",
        }}>
          {locations.slice().reverse().map((loc, i) => {
            const idx = locations.length - 1 - i;
            const isStart = idx === 0;
            const isEnd = idx === locations.length - 1;
            const isActive = idx === activeIndex;
            const dotColor = isStart ? "#16a34a" : isEnd ? "#dc2626" : "#f97316";
            const slotObj = findSlotObj(loc.LATITUDE, loc.LONGITUDE);

            return (
              <div
                key={idx}
                onClick={() => onSelect(idx)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "7px 10px",
                  borderBottom: "1px solid #f3f4f6",
                  cursor: "pointer",
                  background: isActive ? "#fff7ed" : "transparent",
                  borderLeft: `3px solid ${isActive ? "#f97316" : "transparent"}`,
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  background: dotColor, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, fontWeight: 800, flexShrink: 0, marginTop: 2,
                }}>
                  {isStart ? "S" : isEnd ? "E" : idx}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 8, color: "#9ca3af", marginBottom: 1 }}>
                    {loc.DATETIME?.replace("T", " ")}
                  </div>
                  {slotObj?.id && (
                    <div style={{
                      fontSize: 9, fontWeight: 700,
                      color: slotNameColor(slotObj.id),
                      background: slotObj.id === "T-PATH" ? "#e0f2fe" : "#fffbeb",
                      padding: "1px 4px", borderRadius: 3,
                      display: "inline-block",
                    }}>
                      {slotObj.id}
                      {slotObj.blockName && ` · ${slotObj.blockName}`}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ================================================================
   COMPACT DETAIL CARD (bottom sheet style)
   ================================================================ */
const DetailCard = ({ point, index, total, onClose }) => {
  if (!point) return null;
  const slotObj = findSlotObj(point.LATITUDE, point.LONGITUDE);
  const isStart = index === 0;
  const isEnd = index === total - 1;
  const badgeColor = isStart ? "#16a34a" : isEnd ? "#dc2626" : "#f97316";
  const label = isStart ? "START" : isEnd ? "END" : `STOP ${index}`;

  return (
    <div style={{
      position: "absolute",
      bottom: 56, left: 12, right: 12,
      zIndex: 2000,
      background: "#fff",
      borderRadius: 14,
      boxShadow: "0 -4px 30px rgba(0,0,0,0.15)",
      border: "1px solid #e5e7eb",
      fontFamily: "monospace",
      overflow: "hidden",
      animation: "slideUp .18s ease",
    }}>
      <div style={{
        background: badgeColor,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 8, letterSpacing: 2 }}>
            {index + 1} / {total}
          </div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>
            {label}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 6,
          color: "#fff", fontSize: 18, width: 28, height: 28,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}>×</button>
      </div>

      <div style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {slotObj && (
          <div style={{
            gridColumn: "1/-1",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: 8,
            padding: "6px 10px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 2,
          }}>
            <span>🅿️</span>
            <div>
              <div style={{ fontSize: 8, color: "#16a34a", letterSpacing: 1 }}>SLOT</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: slotNameColor(slotObj.id) }}>
                {slotObj.id}
              </div>
            </div>
            {slotObj.blockName && (
              <div style={{
                marginLeft: "auto",
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 5,
                padding: "3px 8px",
                fontSize: 11,
                fontWeight: 800,
                color: "#1d4ed8",
              }}>
                {slotObj.blockName}
              </div>
            )}
          </div>
        )}

        {[
          ["📦", "Container", point.CONTAINERNO],
          ["🏗️", "Equipment", point.EQUIPMENTID],
          ["🕐", "Time", point.DATETIME?.split("T")[1] || ""],
          ["📍", "Coords", `${parseFloat(point.LATITUDE).toFixed(4)}, ${parseFloat(point.LONGITUDE).toFixed(4)}`],
        ].map(([icon, label, val]) => (
          <div key={label} style={{
            background: "#f8fafc",
            borderRadius: 7,
            padding: "6px 8px",
          }}>
            <div style={{ fontSize: 8, color: "#9ca3af", letterSpacing: 1 }}>{icon} {label}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#111", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {val}
            </div>
          </div>
        ))}
      </div>

      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
};

/* ================================================================
   MAIN PAGE
   ================================================================ */
const MapPage = () => {
  const [locations, setLocations] = useState([]);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(null);
  const [latLongInput, setLatLongInput] = useState("");
  const [searchedPosition, setSearchedPosition] = useState(null);
  const [searchBlock, setSearchBlock] = useState("");
  const [highlightedSlot, setHighlightedSlot] = useState(null);
  const [timelineOpen, setTimelineOpen] = useState(false);

  // Live truck
  const [livePosition, setLivePosition] = useState(null);
  const [livePath, setLivePath] = useState([]);
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [liveConnected, setLiveConnected] = useState(false);
  const lastPosRef = useRef(null);
  const lastTimeRef = useRef(null);

  const center = [28.5094, 77.2908];

  useEffect(() => {
    const socket = io("http://14.96.226.166:3002");
    socket.on("connect", () => setLiveConnected(true));
    socket.on("disconnect", () => setLiveConnected(false));
    socket.on("gnss", (data) => {
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
        setLiveSpeed(dt > 0 ? Math.round((dist / dt) * 3.6) : 0);
      }

      lastPosRef.current = newPos;
      lastTimeRef.current = now;
      setLivePath((prev) => [...prev.slice(-300), [newPos.lat, newPos.lng]]);
      setLivePosition(newPos);
    });
    return () => socket.disconnect();
  }, []);

  const handleLatLongSearch = () => {
    const parts = latLongInput.split(",");
    if (parts.length !== 2) return alert("Enter: lat,long");
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return alert("Invalid coordinates");
    setSearchedPosition([lat, lng]);
  };

  const handleSearchBlock = () => {
   const found = slots.find(
  (s) => s.id.toLowerCase() === searchBlock.trim().toLowerCase()
);
    if (!found) return alert("Block not found");
    setHighlightedSlot(found);
  };

  const fetchData = useCallback(async (containerNo) => {
    if (!containerNo.trim()) return;
    setError("");
    setActiveIndex(null);
    try {
      const res = await axios.get(`http://localhost:5000/api/getlocation?container=${containerNo}`);
      const data = res.data.data || [];
      setLocations(data.reverse());
      if (!data.length) setError("No locations found.");
    } catch {
      setError("Failed to fetch.");
    }
  }, []);

  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;

  const pathPositions = useMemo(
    () => locations.map((loc) => [parseFloat(loc.LATITUDE), parseFloat(loc.LONGITUDE)]),
    [locations]
  );
  const activePoint = activeIndex !== null ? locations[activeIndex] : null;

  return (
    <div style={{
      fontFamily: "'DM Mono', 'Courier New', monospace",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* HEADER */}
      <div style={{
        padding: "8px 12px",
        background: "#fff",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        gap: 8,
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        zIndex: 1100,
        flexShrink: 0,
        flexWrap: "wrap",
      }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", letterSpacing: 2, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ background: "#0f172a", color: "#fff", borderRadius: 5, padding: "2px 7px", fontSize: 10 }}>SUNIC</span>
          TRACK
        </div>

        <div style={{ display: "flex", gap: 6, flex: 1, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="BLOCK NAME"
            value={searchBlock}
            onChange={(e) => setSearchBlock(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleSearchBlock()}
            style={{
              padding: "6px 10px", width: 130, minWidth: 0,
              border: "1.5px solid #e5e7eb", borderRadius: 7,
              fontSize: 11, fontFamily: "inherit", letterSpacing: 1,
              outline: "none", background: "#f8fafc",
            }}
          />
          <button onClick={handleSearchBlock} style={btnStyle("#f97316")}>GO</button>

          <input
            type="text"
            placeholder="LAT,LONG"
            value={latLongInput}
            onChange={(e) => setLatLongInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLatLongSearch()}
            style={{
              padding: "6px 10px", width: 130, minWidth: 0,
              border: "1.5px solid #e5e7eb", borderRadius: 7,
              fontSize: 11, background: "#f8fafc",
            }}
          />
          <button onClick={handleLatLongSearch} style={btnStyle("#2563eb")}>GO</button>
        </div>

        {error && <div style={{ fontSize: 10, color: "#dc2626" }}>{error}</div>}
      </div>

      {/* MAP */}
      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer
          center={center}
          zoom={18}
          style={{ height: "100%", width: "100%", background: "#fff" }}
          preferCanvas={true}
        >
          <ZoomToSlot slot={highlightedSlot} />
          <ZoomToLatLng position={searchedPosition} />
          <ViewportSlots activePoint={activePoint} highlightedSlot={highlightedSlot} />

          <LiveTruckMarker position={livePosition} />

          {livePath.length > 1 && (
            <Polyline
              positions={livePath}
              pathOptions={{ color: "#00d4ff", weight: 2.5, opacity: 0.7, dashArray: "6 4" }}
            />
          )}

          {searchedPosition && (
            <Marker
              position={searchedPosition}
              icon={L.divIcon({ html: "📍", className: "", iconSize: [20, 20], iconAnchor: [10, 20] })}
            >
              <Popup>
                <div style={{ fontFamily: "monospace", fontSize: 11 }}>
                  <b>Custom Location</b><br />
                  {searchedPosition[0].toFixed(5)}, {searchedPosition[1].toFixed(5)}<br />
                  Slot: {findSlot(searchedPosition[0], searchedPosition[1]) || "None"}<br />
                  Block: {findSlotObj(searchedPosition[0], searchedPosition[1])?.blockName || "None"}
                </div>
              </Popup>
            </Marker>
          )}

          {pathPositions.length > 1 && (
            <>
              <Polyline positions={pathPositions}
                pathOptions={{ color: "#fed7aa", weight: 8, lineCap: "round", lineJoin: "round", opacity: 0.5 }}
              />
              <Polyline positions={pathPositions}
                pathOptions={{ color: "#f97316", weight: 2.5, dashArray: "7 5", lineCap: "round" }}
              />
            </>
          )}

          <FitBounds positions={pathPositions} />

          {locations.map((loc, index) => {
            if (index === 0 || index === locations.length - 1) return null;
            return (
              <Marker
                key={index}
                position={[parseFloat(loc.LATITUDE), parseFloat(loc.LONGITUDE)]}
                icon={makeStopIcon(index, activeIndex === index)}
                eventHandlers={{ click: () => setActiveIndex(index) }}
              />
            );
          })}

          {pathPositions.length > 0 && (
            <Marker position={pathPositions[0]} icon={startIcon}
              eventHandlers={{ click: () => setActiveIndex(0) }} />
          )}
          {pathPositions.length > 1 && (
            <Marker position={pathPositions[pathPositions.length - 1]} icon={endIcon}
              eventHandlers={{ click: () => setActiveIndex(locations.length - 1) }} />
          )}
        </MapContainer>

        {/* Timeline toggle */}
        <TimelinePanel
          locations={locations}
          activeIndex={activeIndex}
          onSelect={(i) => { setActiveIndex(i); setTimelineOpen(false); }}
          open={timelineOpen}
          onToggle={() => setTimelineOpen((v) => !v)}
        />

        {/* Detail card */}
        {activePoint && (
          <DetailCard
            point={activePoint}
            index={activeIndex}
            total={locations.length}
            onClose={() => setActiveIndex(null)}
          />
        )}

        {/* Live slot HUD */}
        <LiveSlotHUD
          position={livePosition}
          speed={liveSpeed}
          connected={liveConnected}
        />
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500;700&display=swap');
        .leaflet-container { background: #ffffff !important; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .leaflet-popup-content-wrapper { border-radius: 10px !important; font-family: 'DM Mono', monospace !important; }
        .leaflet-popup-tip { display: none; }
      `}</style>
    </div>
  );
};

const btnStyle = (bg) => ({
  padding: "6px 12px",
  background: bg,
  color: "#fff",
  border: "none",
  borderRadius: 7,
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
});

export default MapPage;