import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const API = "http://localhost:4000";

// Campus bounding box - keeps the map locked to Thapar Institute.
const SOUTH_WEST = [30.3500, 76.3590];
const NORTH_EAST = [30.3570, 76.3760];
const CENTRE = [30.3535, 76.3675];
const MAX_SCORE = 1000;

// Size the map returns to on a double-click of the handle.
const DEFAULT_SIZE = { w: 620, h: 400 };

// Limits for the drag-resize.
const MIN_W = 280;
const MIN_H = 200;

// When the cursor leaves the map it shrinks to this fraction of
// whatever size the player dragged it to.
const COMPACT_RATIO = 0.55;

const guessIcon = L.divIcon({
  className: "",
  html: '<div class="pin pin-guess"></div>',
  iconSize: [26, 34],
  iconAnchor: [13, 34]
});

const answerIcon = L.divIcon({
  className: "",
  html: '<div class="pin pin-answer"></div>',
  iconSize: [26, 34],
  iconAnchor: [13, 34]
});

function formatDistance(metres) {
  if (metres < 1000) return Math.round(metres) + " m";
  return (metres / 1000).toFixed(2) + " km";
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

export default function App() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const guessMarkerRef = useRef(null);
  const answerLayersRef = useRef([]);
  const resultRef = useRef(null);
  const dragStateRef = useRef(null);
  const frameRef = useRef(0);

  const [challenge, setChallenge] = useState(null);
  const [guess, setGuess] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [barWidth, setBarWidth] = useState(0);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [dragging, setDragging] = useState(false);

  const expanded = pinned || hovering || dragging;

  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  useEffect(() => {
    fetch(API + "/api/challenge/today")
      .then((res) => {
        if (!res.ok) throw new Error("server returned " + res.status);
        return res.json();
      })
      .then(setChallenge)
      .catch((err) => setError("Could not load today's challenge: " + err.message));
  }, []);

  // Build the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = L.map(containerRef.current, {
      center: CENTRE,
      zoom: 16,
      minZoom: 15,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: false,
      maxBounds: L.latLngBounds(SOUTH_WEST, NORTH_EAST),
      maxBoundsViscosity: 1.0
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19
    }).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);

    map.on("click", (event) => {
      if (resultRef.current) return;

      const { lat, lng } = event.latlng;
      setGuess({ lat, lng });

      if (guessMarkerRef.current) {
        guessMarkerRef.current.setLatLng(event.latlng);
      } else {
        guessMarkerRef.current = L.marker(event.latlng, { icon: guessIcon }).addTo(map);
      }
    });

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Leaflet must be told whenever its container changes size.
  // 320ms matches the CSS transition.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || dragging) return;
    const id = setTimeout(() => map.invalidateSize(), 320);
    return () => clearTimeout(id);
  }, [expanded, result, dragging]);

  useEffect(() => {
    if (!result) {
      setBarWidth(0);
      return;
    }
    const id = setTimeout(() => setBarWidth((result.score / MAX_SCORE) * 100), 400);
    return () => clearTimeout(id);
  }, [result]);

  // ---------------------------------------------------------------
  // Drag-to-resize. The dock is anchored bottom-right, so dragging
  // the top-left handle left and up makes the map larger.
  // ---------------------------------------------------------------
  function beginResize(clientX, clientY) {
    dragStateRef.current = {
      startX: clientX,
      startY: clientY,
      startW: size.w,
      startH: size.h
    };
    setPinned(true);      // stay open for the whole drag
    setDragging(true);
  }

  function moveResize(clientX, clientY) {
    const state = dragStateRef.current;
    if (!state) return;

    const maxW = window.innerWidth - 60;
    const maxH = window.innerHeight - 190;

    const nextW = clamp(state.startW + (state.startX - clientX), MIN_W, maxW);
    const nextH = clamp(state.startH + (state.startY - clientY), MIN_H, maxH);

    setSize({ w: nextW, h: nextH });

    // Redraw tiles smoothly while the drag is in progress.
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      if (mapRef.current) mapRef.current.invalidateSize({ animate: false });
    });
  }

  function endResize() {
    dragStateRef.current = null;
    setDragging(false);
    if (mapRef.current) mapRef.current.invalidateSize();
  }

  // Listeners live on window so the drag survives the cursor
  // leaving the handle, which it always does.
  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e) => moveResize(e.clientX, e.clientY);
    const onTouchMove = (e) => {
      if (e.touches.length) moveResize(e.touches[0].clientX, e.touches[0].clientY);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endResize);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", endResize);
    document.body.classList.add("resizing");

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endResize);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", endResize);
      document.body.classList.remove("resizing");
    };
  }, [dragging]);

  function resetSize() {
    setSize(DEFAULT_SIZE);
    setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 320);
  }

  async function submitGuess() {
    if (!challenge || !guess || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch(API + "/api/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          lat: guess.lat,
          lng: guess.lng
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "request failed");

      setResult(data);
      revealAnswer(data);
    } catch (err) {
      setError("Could not submit your guess: " + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function revealAnswer(data) {
    const map = mapRef.current;
    if (!map) return;

    const answerPoint = [data.actualLat, data.actualLng];
    const guessPoint = [guess.lat, guess.lng];

    const answerMarker = L.marker(answerPoint, { icon: answerIcon })
      .addTo(map)
      .bindTooltip(data.name, { permanent: true, direction: "top", offset: [0, -30] });

    const line = L.polyline([guessPoint, answerPoint], {
      color: "#ffffff",
      weight: 3,
      opacity: 0.9,
      dashArray: "8 8"
    }).addTo(map);

    answerLayersRef.current = [answerMarker, line];

    setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(L.latLngBounds([guessPoint, answerPoint]), { padding: [80, 80] });
    }, 360);
  }

  function playAgain() {
    const map = mapRef.current;

    answerLayersRef.current.forEach((layer) => map.removeLayer(layer));
    answerLayersRef.current = [];

    if (guessMarkerRef.current) {
      map.removeLayer(guessMarkerRef.current);
      guessMarkerRef.current = null;
    }

    setGuess(null);
    setResult(null);
    setError("");
    setPinned(false);
    map.setView(CENTRE, 16);
    setTimeout(() => map.invalidateSize(), 320);
  }

  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  // Inline sizing only applies before the result is revealed;
  // after that the CSS centre-stage layout takes over.
  const compactW = Math.max(MIN_W, Math.round(size.w * COMPACT_RATIO));
  const compactH = Math.max(160, Math.round(size.h * COMPACT_RATIO));

  const dockStyle = result ? undefined : { width: (expanded ? size.w : compactW) + "px" };
  const frameStyle = result ? undefined : { height: (expanded ? size.h : compactH) + "px" };

  return (
    <div className="stage">
      {challenge ? (
        <img className="scene" src={challenge.photoUrl} alt="Today's campus landmark" />
      ) : (
        <div className="scene scene-loading">Loading today's location...</div>
      )}
      <div className="vignette" />

      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">CG</span>
          <span className="brand-text">
            Campus Geoguessr
            <small>Thapar Institute</small>
          </span>
        </div>
        <div className="round-chip">
          <small>Daily challenge</small>
          <strong>{today}</strong>
        </div>
      </div>

      {error && <div className="error-toast">{error}</div>}

      <div className={"backdrop" + (result ? " visible" : "")} />

      <div
        className={
          "map-dock" +
          (expanded ? " expanded" : "") +
          (result ? " result-mode" : "") +
          (dragging ? " dragging" : "")
        }
        style={dockStyle}
        onMouseEnter={() => !result && setHovering(true)}
        onMouseLeave={() => !result && !dragging && setHovering(false)}
      >
        <div className="map-frame" style={frameStyle}>
          <div ref={containerRef} className="map" />

          {!result && (
            <>
              <div
                className="resize-handle"
                title="Drag to resize. Double-click to reset."
                onMouseDown={(e) => {
                  e.preventDefault();
                  beginResize(e.clientX, e.clientY);
                }}
                onTouchStart={(e) => {
                  const touch = e.touches[0];
                  beginResize(touch.clientX, touch.clientY);
                }}
                onDoubleClick={resetSize}
              >
                <span />
              </div>

              <button
                className="pin-toggle"
                onClick={() => setPinned((value) => !value)}
                title={pinned ? "Let the map shrink again" : "Keep the map open"}
              >
                {pinned ? "Unpin" : "Pin"}
              </button>
            </>
          )}
        </div>

        {!result ? (
          <button
            className={"guess-btn" + (guess ? "" : " disabled")}
            onClick={submitGuess}
            disabled={!guess || submitting}
          >
            {submitting ? "Checking..." : guess ? "Guess" : "Place your pin on the map"}
          </button>
        ) : (
          <div className="score-panel">
            <div className="score-bar-track">
              <div className="score-bar-fill" style={{ width: barWidth + "%" }} />
            </div>
            <div className="score-line">
              <strong>{result.score}</strong> points
            </div>
            <p className="score-detail">
              Your guess was <strong>{formatDistance(result.distanceMetres)}</strong> from{" "}
              <strong>{result.name}</strong>
            </p>
            <button className="next-btn" onClick={playAgain}>
              Play again
            </button>
          </div>
        )}
      </div>

      <div className="credits">
        Photos and place data from Google Maps. Map tiles from OpenStreetMap contributors.
      </div>
    </div>
  );
}