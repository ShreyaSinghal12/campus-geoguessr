import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, photoSrc } from "./api";
import AuthScreen from "./AuthScreen";
import { StatsPanel, LeaderboardPanel } from "./Overlays";
import AdminPanel from "./AdminPanel";
import "./App.css";

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

const TIER_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" };

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

function msUntilMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (
    String(h).padStart(2, "0") + ":" +
    String(m).padStart(2, "0") + ":" +
    String(s).padStart(2, "0")
  );
}

// Spoiler-free summary of the whole day. Plain ASCII so it pastes
// cleanly anywhere, and it never names a landmark.
function buildShareText(challengeNumber, rounds) {
  const lines = ["Campus Geoguessr #" + challengeNumber];
  let total = 0;

  for (const round of rounds) {
    const label = TIER_LABEL[round.difficulty].padEnd(6, " ");

    if (!round.played) {
      lines.push(label + " [" + ".".repeat(16) + "]    -");
      continue;
    }

    total += round.played.score;
    const filled = Math.round((round.played.score / MAX_SCORE) * 16);
    const bar = "#".repeat(filled) + ".".repeat(16 - filled);
    lines.push(label + " [" + bar + "] " + String(round.played.score).padStart(4, " "));
  }

  lines.push("Total  " + total + "/" + MAX_SCORE * rounds.length);
  return lines.join("\n");
}

export default function App() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const guessMarkerRef = useRef(null);
  const answerLayersRef = useRef([]);
  const roundRef = useRef(null);
  const guessRef = useRef(null);
  const submitRef = useRef(null);
  const dragStateRef = useRef(null);
  const frameRef = useRef(0);

  // undefined means "still checking", null means signed out.
  const [user, setUser] = useState(undefined);
  const [challengeNumber, setChallengeNumber] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [guess, setGuess] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [dragging, setDragging] = useState(false);
  const [shownScore, setShownScore] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [showStats, setShowStats] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [untilNext, setUntilNext] = useState(msUntilMidnight());

  const round = rounds[activeIndex] || null;
  const result = round ? round.played || null : null;
  const expanded = pinned || hovering || dragging;

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    guessRef.current = guess;
  }, [guess]);

  useEffect(() => {
    api.me()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));

    loadChallenges();
  }, []);

  function loadChallenges() {
    api.today()
      .then((data) => {
        setChallengeNumber(data.challengeNumber);
        setRounds(data.rounds);

        // Open on the first round still unplayed, so a returning
        // player picks up where they left off.
        const next = data.rounds.findIndex((r) => !r.played);
        setActiveIndex(next === -1 ? 0 : next);
      })
      .catch((err) => setError("Could not load today's challenges: " + err.message));
  }

  function handleSignedIn(signedIn) {
    setUser(signedIn);
    loadChallenges();
  }

  async function handleSignOut() {
    try {
      await api.logout();
    } catch (err) {
      // Signing out locally is still the right outcome.
    }
    window.location.reload();
  }

  // Build the map once the game screen exists.
  useEffect(() => {
    if (!user) return;
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
      const current = roundRef.current;
      if (!current || current.played) return;

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
  }, [user]);

  // Single source of truth for what the map shows. Runs whenever the
  // active round changes or a result arrives, so switching tiers and
  // submitting a guess both go through the same path.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !round) return;

    answerLayersRef.current.forEach((layer) => map.removeLayer(layer));
    answerLayersRef.current = [];

    if (guessMarkerRef.current) {
      map.removeLayer(guessMarkerRef.current);
      guessMarkerRef.current = null;
    }

    if (round.played) {
      const played = round.played;
      const guessPoint = played.guessLat != null
        ? [played.guessLat, played.guessLng]
        : null;

      if (guessPoint) {
        guessMarkerRef.current = L.marker(guessPoint, { icon: guessIcon }).addTo(map);
      }

      const answerPoint = [played.actualLat, played.actualLng];

      const answerMarker = L.marker(answerPoint, { icon: answerIcon })
        .addTo(map)
        .bindTooltip(played.name, { permanent: true, direction: "top", offset: [0, -32] });

      answerLayersRef.current = [answerMarker];

      if (guessPoint) {
        const line = L.polyline([guessPoint, answerPoint], {
          color: "#ffffff",
          weight: 3,
          opacity: 0.9,
          dashArray: "9 9"
        }).addTo(map);

        answerLayersRef.current.push(line);
      }

      setTimeout(() => {
        map.invalidateSize();
        if (guessPoint) {
          map.fitBounds(L.latLngBounds([guessPoint, answerPoint]), { padding: [110, 110] });
        } else {
          map.setView(answerPoint, 17);
        }
      }, 380);
    } else {
      map.setView(CENTRE, 16);
      setTimeout(() => map.invalidateSize(), 340);
    }
  }, [activeIndex, rounds, user]);

  // Switching tier starts that round fresh.
  useEffect(() => {
    setGuess(null);
    setSecondsLeft(ROUND_SECONDS);
    setError("");
  }, [activeIndex]);

  // The reveal has its own layout, so fullscreen play mode ends there.
  useEffect(() => {
    if (result) setFullscreen(false);
  }, [result]);

  // Leaflet has to be told whenever its container changes size.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || dragging) return;
    const id = setTimeout(() => map.invalidateSize(), 340);
    return () => clearTimeout(id);
  }, [expanded, dragging, fullscreen]);

  // Escape leaves the fullscreen map.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Round timer. Does not run on a round already answered.
  useEffect(() => {
    if (!user || !round || round.played) return;

    const id = setInterval(() => {
      setSecondsLeft((previous) => {
        if (previous <= 1) {
          clearInterval(id);
          if (submitRef.current) submitRef.current(true);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [user, round]);

  useEffect(() => {
    if (!result) return;
    const id = setInterval(() => setUntilNext(msUntilMidnight()), 1000);
    return () => clearInterval(id);
  }, [result]);

  // Count the score up once a result exists for the active round.
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
  }, [result, activeIndex]);

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
  // Submitting
  // ---------------------------------------------------------------
  async function submitGuess(fromTimeout) {
    const current = roundRef.current;
    const currentGuess = guessRef.current;

    if (!current || current.played || submitting) return;
    if (!currentGuess && !fromTimeout) return;

    setSubmitting(true);
    setError("");

    // Out of time with no pin: send the campus centre so the server
    // still returns the answer, then force the score to zero.
    const payload = currentGuess
      ? { challengeId: current.challengeId, lat: currentGuess.lat, lng: currentGuess.lng }
      : { challengeId: current.challengeId, lat: CENTRE[0], lng: CENTRE[1] };

    try {
      const data = await api.guess(payload);

      const played = currentGuess
        ? { ...data, guessLat: currentGuess.lat, guessLng: currentGuess.lng }
        : { ...data, score: 0, skipped: true, guessLat: null, guessLng: null };

      setRounds((previous) =>
        previous.map((r) =>
          r.challengeId === current.challengeId ? { ...r, played } : r
        )
      );
    } catch (err) {
      if (err.status === 409) {
        setError("You have already played this round. Loading your result.");
        loadChallenges();
      } else if (err.status === 401) {
        setError("Your session expired. Sign in again.");
        setUser(null);
      } else {
        setError("Could not submit your guess: " + err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    submitRef.current = submitGuess;
  });

  async function share() {
    if (challengeNumber === null) return;

    const text = buildShareText(challengeNumber, rounds);

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError("Could not copy. Your browser blocked clipboard access.");
    }
  }

  function goToNextRound() {
    const next = rounds.findIndex((r, i) => i > activeIndex && !r.played);
    if (next !== -1) {
      setActiveIndex(next);
      return;
    }
    const any = rounds.findIndex((r) => !r.played);
    if (any !== -1) setActiveIndex(any);
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  if (user === undefined) {
    return <div className="boot">Loading...</div>;
  }

  if (user === null) {
    return (
      <AuthScreen
        backdropUrl={rounds.length > 0 ? photoSrc(rounds[0].photoUrl) : null}
        onSignedIn={handleSignedIn}
      />
    );
  }

  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  const compactW = Math.max(MIN_W, Math.round(size.w * COMPACT_RATIO));
  const compactH = Math.max(170, Math.round(size.h * COMPACT_RATIO));

  // Inline sizing is skipped in fullscreen and on the result screen,
  // where the CSS layout takes over completely.
  const sized = !result && !fullscreen;
  const dockStyle = sized ? { width: (expanded ? size.w : compactW) + "px" } : undefined;
  const frameStyle = sized ? { height: (expanded ? size.h : compactH) + "px" } : undefined;

  const urgent = secondsLeft <= 20 && !result;
  const dayTotal = rounds.reduce((sum, r) => sum + (r.played ? r.played.score : 0), 0);
  const allDone = rounds.length > 0 && rounds.every((r) => r.played);
  const hasNext = rounds.some((r, i) => i !== activeIndex && !r.played);

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
        {round ? (
          <img className="scene" src={photoSrc(round.photoUrl)} alt="Today's campus landmark" />
        ) : (
          <div className="scene scene-loading">Loading today's challenges...</div>
        )}
        {result && (
          <div className="scene-caption">
            <small>{TIER_LABEL[round.difficulty]} round</small>
            <strong>{result.name}</strong>
          </div>
        )}
      </div>

      {!result && <div className="vignette" />}

      {rounds.length > 0 && !fullscreen && (
        <div className="tier-tabs">
          {rounds.map((r, index) => (
            <button
              key={r.challengeId}
              className={
                "tier" +
                (index === activeIndex ? " active" : "") +
                (r.played ? " done" : "")
              }
              onClick={() => setActiveIndex(index)}
            >
              <small>{TIER_LABEL[r.difficulty]}</small>
              <strong>{r.played ? r.played.score : "-"}</strong>
            </button>
          ))}
        </div>
      )}

      {!result && !fullscreen && (
        <div className="hud-centre">
          <div className={"timer" + (urgent ? " urgent" : "")}>
            {formatClock(secondsLeft)}
          </div>
        </div>
      )}

      {!result && !fullscreen && (
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

      {!fullscreen && (
        <div className="brand">
          <span className="brand-mark">CG</span>
          <span className="brand-text">
            Campus Geoguessr
            <small>Thapar Institute</small>
          </span>
        </div>
      )}

      {!fullscreen && (
        <div className="scoreboard">
          <div className="score-cell">
            <small>Day</small>
            <strong>#{challengeNumber === null ? "-" : challengeNumber}</strong>
          </div>
          <div className="score-cell">
            <small>Date</small>
            <strong>{today}</strong>
          </div>
          <div className="score-cell">
            <small>{result ? "Distance" : "Time"}</small>
            <strong>
              {result ? formatDistance(result.distanceMetres) : formatClock(secondsLeft)}
            </strong>
          </div>
          <div className="score-cell total">
            <small>Day total</small>
            <strong>{dayTotal}</strong>
          </div>
        </div>
      )}

      {!fullscreen && (
        <div className="user-bar">
          <button onClick={() => setShowStats(true)}>Stats</button>
          <button onClick={() => setShowBoard(true)}>Leaderboard</button>
          {user.isAdmin && <button onClick={() => setShowAdmin(true)}>Admin</button>}
          <span className="who">{user.username}</span>
          <button className="ghost" onClick={handleSignOut}>Sign out</button>
        </div>
      )}

      {error && <div className="error-toast">{error}</div>}

      <div
        className={
          "map-dock" +
          (expanded ? " expanded" : "") +
          (result ? " result-mode" : "") +
          (fullscreen && !result ? " fullscreen" : "") +
          (dragging ? " dragging" : "")
        }
        style={dockStyle}
        onMouseEnter={() => !result && setHovering(true)}
        onMouseLeave={() => !result && !dragging && setHovering(false)}
      >
        <div className="map-frame" style={frameStyle}>
          <div ref={containerRef} className="map" />

          {!result && (
            <button
              className="fs-toggle"
              onClick={() => setFullscreen((value) => !value)}
              title={fullscreen ? "Back to the photo (Esc)" : "Fill the screen with the map"}
            >
              {fullscreen ? "Exit map" : "Expand"}
            </button>
          )}

          {!result && !fullscreen && (
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

          <div className="result-centre">
            {hasNext ? (
              <button className="next-btn" onClick={goToNextRound}>
                Next round
              </button>
            ) : (
              <button className="next-btn" onClick={share}>
                {copied ? "Copied" : "Share"}
              </button>
            )}
            <div className="next-timer">
              {allDone
                ? "New challenges in " + formatCountdown(untilNext)
                : "Three rounds a day: easy, medium, hard"}
            </div>
          </div>

          <div className="result-right">
            <div className="points-ring">{shownScore}</div>
            <small>of {MAX_SCORE} points</small>
            <div className="points-bar">
              <div className="points-fill" style={{ width: barWidth + "%" }} />
            </div>
          </div>
        </div>
      )}

      {!result && !fullscreen && (
        <div className="credits">
          Photos by the project team. Map tiles from OpenStreetMap contributors.
        </div>
      )}

      {showStats && <StatsPanel onClose={() => setShowStats(false)} />}
      {showBoard && (
        <LeaderboardPanel username={user.username} onClose={() => setShowBoard(false)} />
      )}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  );
}