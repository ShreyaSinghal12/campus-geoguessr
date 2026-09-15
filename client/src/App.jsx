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
const ROUND_SECONDS = 120;

const DEFAULT_SIZE = { w: 640, h: 420 };
const MIN_W = 300;
const MIN_H = 210;
const COMPACT_RATIO = 0.55;

const guessIcon = L.divIcon({
  className: "",
  html: '<div class="pin pin-guess"></div>',
  iconSize: [28, 36],
  iconAnchor: [14, 36]
});

const answerIcon = L.divIcon({
  className: "",
  html: '<div class="pin pin-answer"></div>',
  iconSize: [28, 36],
  iconAnchor: [14, 36]
});

function formatDistance(metres) {
  if (metres < 1000) return Math.round(metres) + " m";
  return (metres / 1000).toFixed(2) + " km";
}

function formatClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
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
  const guessRef = useRef(null);
  const submitRef = useRef(null);
  const dragStateRef = useRef(null);
  const frameRef = useRef(0);

  const [challenge, setChallenge] = useState(null);
  const [guess, setGuess] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [dragging, setDragging] = useState(false);
  const [shownScore, setShownScore] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [timedOut, setTimedOut] = useState(false);

  const expanded = pinned || hovering || dragging;

  // Mirrors for the timer and map handlers, which are registered
  // once and would otherwise capture stale state.
  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  useEffect(() => {
    guessRef.current = guess;
  }, [guess]);

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

  // ---------------------------------------------------------------
  // Round timer. Ticks only while a challenge is loaded and no
  // result has been revealed. Reaching zero submits automatically.
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!challenge || result) return;

    const id = setInterval(() => {
      setSecondsLeft((previous) => {
        if (previous <= 1) {
          clearInterval(id);
          setTimedOut(true);
          if (submitRef.current) submitRef.current(true);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [challenge, result]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || dragging) return;
    const id = setTimeout(() => map.invalidateSize(), 340);
    return () => clearTimeout(id);
  }, [expanded, result, dragging]);

  // Count the score up once the result lands.
  useEffect(() => {
    if (!result) {
      setShownScore(0);
      setBarWidth(0);
      return;
    }

    const barTimer = setTimeout(() => setBarWidth((result.score / MAX_SCORE) * 100), 500);

    const target = result.score;
    const duration = 1100;
    const startedAt = performance.now();
    let raf;

    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShownScore(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    const startTimer = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, 500);

    return () => {
      clearTimeout(barTimer);
      clearTimeout(startTimer);
      cancelAnimationFrame(raf);
    };
  }, [result]);

  // Space advances from the result screen.
  useEffect(() => {
    if (!result) return;
    const onKey = (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        playAgain();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result]);

  // ---------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------
  function beginResize(clientX, clientY) {
    dragStateRef.current = {
      startX: clientX,
      startY: clientY,
      startW: size.w,
      startH: size.h
    };
    setPinned(true);
    setDragging(true);
  }

  function moveResize(clientX, clientY) {
    const state = dragStateRef.current;
    if (!state) return;

    setSize({
      w: clamp(state.startW + (state.startX - clientX), MIN_W, window.innerWidth - 60),
      h: clamp(state.startH + (state.startY - clientY), MIN_H, window.innerHeight - 200)
    });

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
    setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 340);
  }

  // ---------------------------------------------------------------
  // Submitting. On timeout with no pin dropped, the round is scored
  // zero locally and the answer is still revealed.
  // ---------------------------------------------------------------
  async function submitGuess(fromTimeout) {
    const currentGuess = guessRef.current;

    if (!challenge || resultRef.current || submitting) return;
    if (!currentGuess && !fromTimeout) return;

    setSubmitting(true);
    setError("");

    // No pin and time is up: use the campus centre so the server
    // still returns the true location, then force the score to 0.
    const payload = currentGuess
      ? { challengeId: challenge.challengeId, lat: currentGuess.lat, lng: currentGuess.lng }
      : { challengeId: challenge.challengeId, lat: CENTRE[0], lng: CENTRE[1] };

    try {
      const response = await fetch(API + "/api/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "request failed");

      const finalResult = currentGuess ? data : { ...data, score: 0, skipped: true };

      setResult(finalResult);
      revealAnswer(finalResult, currentGuess);
    } catch (err) {
      setError("Could not submit your guess: " + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Kept in a ref so the timer can call the latest version.
  useEffect(() => {
    submitRef.current = submitGuess;
  });

  function revealAnswer(data, usedGuess) {
    const map = mapRef.current;
    if (!map) return;

    const answerPoint = [data.actualLat, data.actualLng];

    const answerMarker = L.marker(answerPoint, { icon: answerIcon })
      .addTo(map)
      .bindTooltip(data.name, { permanent: true, direction: "top", offset: [0, -32] });

    answerLayersRef.current = [answerMarker];

    if (usedGuess) {
      const guessPoint = [usedGuess.lat, usedGuess.lng];
      const line = L.polyline([guessPoint, answerPoint], {
        color: "#ffffff",
        weight: 3,
        opacity: 0.9,
        dashArray: "9 9"
      }).addTo(map);

      answerLayersRef.current.push(line);

      setTimeout(() => {
        map.invalidateSize();
        map.fitBounds(L.latLngBounds([guessPoint, answerPoint]), { padding: [110, 110] });
      }, 380);
    } else {
      setTimeout(() => {
        map.invalidateSize();
        map.setView(answerPoint, 17);
      }, 380);
    }
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
    setSecondsLeft(ROUND_SECONDS);
    setTimedOut(false);
    map.setView(CENTRE, 16);
    setTimeout(() => map.invalidateSize(), 340);
  }

  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  const compactW = Math.max(MIN_W, Math.round(size.w * COMPACT_RATIO));
  const compactH = Math.max(170, Math.round(size.h * COMPACT_RATIO));

  const dockStyle = result ? undefined : { width: (expanded ? size.w : compactW) + "px" };
  const frameStyle = result ? undefined : { height: (expanded ? size.h : compactH) + "px" };

  const urgent = secondsLeft <= 20 && !result;

  const verdict = result
    ? result.skipped
      ? "Timed out"
      : result.distanceMetres < 40
      ? "Spot on"
      : result.distanceMetres < 150
      ? "Very close"
      : result.distanceMetres < 400
      ? "Not bad"
      : "Way off"
    : "";

  return (
    <div className={"stage" + (result ? " revealed" : "")}>
      <div className="scene-holder">
        {challenge ? (
          <img className="scene" src={challenge.photoUrl} alt="Today's campus landmark" />
        ) : (
          <div className="scene scene-loading">Loading today's location...</div>
        )}
        {result && (
          <div className="scene-caption">
            <small>Landmark</small>
            <strong>{result.name}</strong>
          </div>
        )}
      </div>

      {!result && <div className="vignette" />}

      {/* Compass strip and countdown, centred at the top */}
      {!result && (
        <div className="hud-centre">
          <div className="compass">
            <span>N</span>
            <i /><i /><i /><i />
            <span>E</span>
            <i /><i /><i /><i />
            <span>S</span>
            <i /><i /><i /><i />
            <span>W</span>
            <i /><i /><i /><i />
            <div className="compass-needle" />
          </div>
          <div className={"timer" + (urgent ? " urgent" : "")}>
            {formatClock(secondsLeft)}
          </div>
        </div>
      )}

      {/* Left control stack */}
      {!result && (
        <div className="side-controls">
          <button onClick={() => mapRef.current && mapRef.current.zoomIn()} title="Zoom in">+</button>
          <button onClick={() => mapRef.current && mapRef.current.zoomOut()} title="Zoom out">-</button>
          <button
            onClick={() => mapRef.current && mapRef.current.setView(CENTRE, 16)}
            title="Recentre the map"
          >
            &#9678;
          </button>
        </div>
      )}

      <div className="brand">
        <span className="brand-mark">CG</span>
        <span className="brand-text">
          Campus Geoguessr
          <small>Thapar Institute</small>
        </span>
      </div>

      {/* Scoreboard strip */}
      <div className="scoreboard">
        <div className={"score-cell" + (!result ? " active" : "")}>
          <small>Round</small>
          <strong>{today}</strong>
        </div>
        <div className="score-cell">
          <small>Time</small>
          <strong>{result ? "--:--" : formatClock(secondsLeft)}</strong>
        </div>
        <div className="score-cell">
          <small>Distance</small>
          <strong>{result ? formatDistance(result.distanceMetres) : "-"}</strong>
        </div>
        <div className="score-cell total">
          <small>Total</small>
          <strong>{result ? shownScore : "-"}</strong>
        </div>
      </div>

      {error && <div className="error-toast">{error}</div>}

      {/* Map dock */}
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

        {!result && (
          <button
            className={"guess-btn" + (guess ? "" : " disabled")}
            onClick={() => submitGuess(false)}
            disabled={!guess || submitting}
          >
            {submitting ? "Checking..." : guess ? "Guess" : "Place your pin on the map"}
          </button>
        )}
      </div>

      {/* Result bar */}
      {result && (
        <div className="result-bar">
          <div className="result-left">
            <div className={"verdict" + (result.skipped ? " timeout" : "")}>{verdict}</div>
            <div className="result-distance">
              {result.skipped
                ? "No pin was placed before time ran out"
                : formatDistance(result.distanceMetres) + " away"}
            </div>
          </div>

          <button className="next-btn" onClick={playAgain}>
            Next
            <em>
              hit <span>space</span> to continue
            </em>
          </button>

          <div className="result-right">
            <div className="points-ring">{shownScore}</div>
            <small>of {MAX_SCORE} points</small>
            <div className="points-bar">
              <div className="points-fill" style={{ width: barWidth + "%" }} />
            </div>
          </div>
        </div>
      )}

      {!result && (
        <div className="credits">
          Photos and place data from Google Maps. Map tiles from OpenStreetMap contributors.
        </div>
      )}
    </div>
  );
}