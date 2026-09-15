const express = require("express");
const cors = require("cors");
const db = require("./db");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// ---------------------------------------------------------------
// Haversine distance between two lat/lng points, returned in metres.
// This runs ONLY on the server. The browser never receives the
// answer coordinates before the player has submitted a guess.
// ---------------------------------------------------------------
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in metres
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Score decays exponentially with distance. 0 m gives 1000 points,
// roughly 140 m gives 500, beyond 600 m it approaches zero.
function scoreFromDistance(metres) {
  return Math.round(1000 * Math.exp(-metres / 200));
}

// ---------------------------------------------------------------
// Health check. Confirms the server is up and the database answers.
// ---------------------------------------------------------------
app.get("/api/health", async (req, res) => {
  try {
    const result = await db.query("SELECT NOW() AS now");
    res.json({ status: "ok", time: result.rows[0].now });
  } catch (err) {
    console.error("Health check failed:", err.message);
    res.status(500).json({ error: "Database unreachable" });
  }
});

// ---------------------------------------------------------------
// GET /api/challenge/today
// Returns ONLY the challenge id and the photo URL.
// The landmark name and its coordinates are deliberately withheld,
// so they cannot be read from the network tab or the page source.
// ---------------------------------------------------------------
app.get("/api/challenge/today", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT dc.id AS challenge_id, l.photo_url
       FROM daily_challenges dc
       JOIN landmarks l ON l.id = dc.landmark_id
       WHERE dc.challenge_date = CURRENT_DATE`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No challenge set for today" });
    }

    res.json({
      challengeId: result.rows[0].challenge_id,
      photoUrl: result.rows[0].photo_url
    });
  } catch (err) {
    console.error("Failed to fetch today's challenge:", err.message);
    res.status(500).json({ error: "Could not load today's challenge" });
  }
});

// ---------------------------------------------------------------
// POST /api/guess
// Body: { challengeId, lat, lng }
// Looks up the true coordinates, computes the distance server-side,
// stores the attempt, and only then reveals the answer.
// ---------------------------------------------------------------
app.post("/api/guess", async (req, res) => {
  const { challengeId, lat, lng } = req.body;

  // Reject anything that is not a usable number.
  if (
    typeof challengeId !== "number" ||
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    Number.isNaN(lat) ||
    Number.isNaN(lng)
  ) {
    return res.status(400).json({ error: "challengeId, lat and lng must be numbers" });
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "Coordinates out of range" });
  }

  try {
    // Only today's challenge may be answered. This stops a player
    // from submitting guesses against past or future challenges.
    const result = await db.query(
      `SELECT l.name, l.lat, l.lng
       FROM daily_challenges dc
       JOIN landmarks l ON l.id = dc.landmark_id
       WHERE dc.id = $1 AND dc.challenge_date = CURRENT_DATE`,
      [challengeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "That challenge is not active today" });
    }

    const actual = result.rows[0];
    const distance = haversineMetres(lat, lng, actual.lat, actual.lng);
    const score = scoreFromDistance(distance);

    await db.query(
      `INSERT INTO guesses (challenge_id, guess_lat, guess_lng, distance_m, score)
       VALUES ($1, $2, $3, $4, $5)`,
      [challengeId, lat, lng, distance, score]
    );

    res.json({
      distanceMetres: Math.round(distance),
      score: score,
      actualLat: actual.lat,
      actualLng: actual.lng,
      name: actual.name
    });
  } catch (err) {
    console.error("Failed to process guess:", err.message);
    res.status(500).json({ error: "Could not process your guess" });
  }
});

app.listen(PORT, () => {
  console.log(`Campus Geoguessr server running on http://localhost:${PORT}`);
});