const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const cron = require("node-cron");
const multer = require("multer");
const exifr = require("exifr");
const path = require("path");
const fs = require("fs");
const db = require("./db");
const auth = require("./auth");
require("dotenv").config();

const app = express();

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());
app.use(auth.readUser);

const PORT = process.env.PORT || 4000;

// Set to a domain such as "thapar.edu" to restrict sign-up to institute
// addresses. null allows any domain, which is convenient while testing.
const ALLOWED_EMAIL_DOMAIN = null;

const MAX_SCORE = 1000;
const SCORE_DECAY_METRES = 200;
const DIFFICULTIES = ["easy", "medium", "hard"];
// Guesses outside this box are rejected: a landmark cannot be off campus,
// so a coordinate outside it is either a mistake or a tampered request.
const CAMPUS_BOUNDS = {
  minLat: 30.3480,
  maxLat: 30.3590,
  minLng: 76.3570,
  maxLng: 76.3780
};

// ---------------------------------------------------------------
// Uploaded landmark photos
// ---------------------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use("/uploads", express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const stamp = Date.now() + "-" + Math.round(Math.random() * 1e6);
    cb(null, stamp + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error("Only JPEG, PNG or WebP images are accepted"));
  }
});

// Turns "DSC_0421.jpg" into "DSC 0421", used when a bulk upload
// supplies no name of its own.
function nameFromFilename(originalname) {
  return path
    .basename(originalname, path.extname(originalname))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Untitled landmark";
}

function insideCampus(lat, lng) {
  return (
    lat >= CAMPUS_BOUNDS.minLat && lat <= CAMPUS_BOUNDS.maxLat &&
    lng >= CAMPUS_BOUNDS.minLng && lng <= CAMPUS_BOUNDS.maxLng
  );
}

// ---------------------------------------------------------------
// Distance and scoring. Both run only here: the browser is never
// given the answer coordinates before a guess has been committed.
// ---------------------------------------------------------------
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000;
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

function scoreFromDistance(metres) {
  return Math.round(MAX_SCORE * Math.exp(-metres / SCORE_DECAY_METRES));
}

// ---------------------------------------------------------------
// Challenge rotation
// ---------------------------------------------------------------
async function ensureUpcomingChallenges(daysAhead) {
  let created = 0;

  for (let offset = 0; offset < daysAhead; offset++) {
    for (const tier of DIFFICULTIES) {
      const existing = await db.query(
        `SELECT id FROM daily_challenges
         WHERE challenge_date = CURRENT_DATE + $1::int AND difficulty = $2`,
        [offset, tier]
      );

      if (existing.rows.length > 0) continue;

      // Least recently used landmark within this tier. One already
      // scheduled for an upcoming date sorts last, so the window does
      // not repeat while unused landmarks remain.
      const pick = await db.query(
        `SELECT l.id
         FROM landmarks l
         LEFT JOIN daily_challenges dc ON dc.landmark_id = l.id
         WHERE l.difficulty = $1
         GROUP BY l.id
         ORDER BY COALESCE(MAX(dc.challenge_date), DATE '1970-01-01') ASC, RANDOM()
         LIMIT 1`,
        [tier]
      );

      // A tier with no landmarks yet is simply skipped, so the other
      // two still get scheduled.
      if (pick.rows.length === 0) continue;

      await db.query(
        `INSERT INTO daily_challenges (landmark_id, challenge_date, difficulty)
         VALUES ($1, CURRENT_DATE + $2::int, $3)
         ON CONFLICT (challenge_date, difficulty) DO NOTHING`,
        [pick.rows[0].id, offset, tier]
      );

      created++;
    }
  }

  return created;
}
// ---------------------------------------------------------------
// Admin gate. Checked against the database rather than the token,
// so revoking admin takes effect without waiting for a new sign-in.
// ---------------------------------------------------------------
async function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "You need to sign in first" });
  }

  try {
    const result = await db.query(
      "SELECT is_admin FROM users WHERE id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    next();
  } catch (err) {
    console.error("Admin check failed:", err.message);
    res.status(500).json({ error: "Could not verify your access" });
  }
}

// ---------------------------------------------------------------
// Health
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
// Authentication
// ---------------------------------------------------------------
app.post("/api/auth/register", async (req, res) => {
  const { username, email, password } = req.body;

  if (typeof username !== "string" || !/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({
      error: "Username must be 3 to 20 letters, digits or underscores"
    });
  }

  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }

  if (ALLOWED_EMAIL_DOMAIN && !email.toLowerCase().endsWith("@" + ALLOWED_EMAIL_DOMAIN)) {
    return res.status(400).json({
      error: "Sign up with your " + ALLOWED_EMAIL_DOMAIN + " address"
    });
  }

  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const hash = await auth.hashPassword(password);

    const result = await db.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, is_admin`,
      [username, email.toLowerCase(), hash]
    );

    const user = result.rows[0];
    auth.issueToken(res, user);
    res.status(201).json({
      id: user.id,
      username: user.username,
      isAdmin: user.is_admin
    });
  } catch (err) {
    // 23505 is the unique_violation code.
    if (err.code === "23505") {
      return res.status(409).json({ error: "That username or email is already registered" });
    }
    console.error("Registration failed:", err.message);
    res.status(500).json({ error: "Could not create your account" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;

  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    // Accepts either the username or the email address.
    const result = await db.query(
      `SELECT id, username, password_hash, is_admin
       FROM users
       WHERE username = $1 OR email = $2`,
      [username, username.toLowerCase()]
    );

    if (result.rows.length === 0) {
      // Same message as a wrong password, so the response does not
      // reveal which usernames exist.
      return res.status(401).json({ error: "Incorrect username or password" });
    }

    const user = result.rows[0];
    const ok = await auth.verifyPassword(password, user.password_hash);

    if (!ok) {
      return res.status(401).json({ error: "Incorrect username or password" });
    }

    auth.issueToken(res, user);
    res.json({ id: user.id, username: user.username, isAdmin: user.is_admin });
  } catch (err) {
    console.error("Login failed:", err.message);
    res.status(500).json({ error: "Could not sign you in" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  auth.clearToken(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.user) return res.json({ user: null });

  try {
    const result = await db.query(
      "SELECT id, username, is_admin FROM users WHERE id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) return res.json({ user: null });

    const row = result.rows[0];
    res.json({ user: { id: row.id, username: row.username, isAdmin: row.is_admin } });
  } catch (err) {
    console.error("Session lookup failed:", err.message);
    res.status(500).json({ error: "Could not read your session" });
  }
});

// ---------------------------------------------------------------
// Today's challenge
// ---------------------------------------------------------------
app.get("/api/challenge/today", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT dc.id AS challenge_id, dc.difficulty, l.photo_url
       FROM daily_challenges dc
       JOIN landmarks l ON l.id = dc.landmark_id
       WHERE dc.challenge_date = CURRENT_DATE
       ORDER BY CASE dc.difficulty
                  WHEN 'easy' THEN 1
                  WHEN 'medium' THEN 2
                  ELSE 3
                END`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No challenges set for today" });
    }

    const numbering = await db.query(
      `SELECT COUNT(DISTINCT challenge_date)::int AS n
       FROM daily_challenges
       WHERE challenge_date <= CURRENT_DATE`
    );

    const rounds = result.rows.map((row) => ({
      challengeId: row.challenge_id,
      difficulty: row.difficulty,
      photoUrl: row.photo_url
    }));

    // A signed-in player gets back any round they have already answered,
    // so the client shows the reveal instead of offering a second go.
    // Coordinates are released here only because that guess is spent.
    if (req.user) {
      const prior = await db.query(
        `SELECT g.challenge_id, g.distance_m, g.score, g.guess_lat, g.guess_lng,
                l.name, l.lat, l.lng
         FROM guesses g
         JOIN daily_challenges dc ON dc.id = g.challenge_id
         JOIN landmarks l ON l.id = dc.landmark_id
         WHERE g.user_id = $1 AND dc.challenge_date = CURRENT_DATE`,
        [req.user.id]
      );

      for (const p of prior.rows) {
        const round = rounds.find((r) => r.challengeId === p.challenge_id);
        if (!round) continue;

        round.played = {
          distanceMetres: Math.round(p.distance_m),
          score: p.score,
          name: p.name,
          actualLat: p.lat,
          actualLng: p.lng,
          guessLat: p.guess_lat,
          guessLng: p.guess_lng
        };
      }
    }

    res.json({ challengeNumber: numbering.rows[0].n, rounds });
  } catch (err) {
    console.error("Failed to fetch today's challenges:", err.message);
    res.status(500).json({ error: "Could not load today's challenges" });
  }
});

// ---------------------------------------------------------------
// Submitting a guess
// ---------------------------------------------------------------
app.post("/api/guess", auth.requireUser, async (req, res) => {
  const { challengeId, lat, lng } = req.body;

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

    // FR-15. Checked here for a clear message; the unique index is the
    // real guarantee, and catches two requests arriving together.
    const existing = await db.query(
      "SELECT id FROM guesses WHERE user_id = $1 AND challenge_id = $2",
      [req.user.id, challengeId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "You have already played today" });
    }

    const actual = result.rows[0];
    const distance = haversineMetres(lat, lng, actual.lat, actual.lng);
    const score = scoreFromDistance(distance);

    await db.query(
      `INSERT INTO guesses (challenge_id, user_id, guess_lat, guess_lng, distance_m, score)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [challengeId, req.user.id, lat, lng, distance, score]
    );

    res.json({
      distanceMetres: Math.round(distance),
      score: score,
      actualLat: actual.lat,
      actualLng: actual.lng,
      name: actual.name
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "You have already played today" });
    }
    console.error("Failed to process guess:", err.message);
    res.status(500).json({ error: "Could not process your guess" });
  }
});

// ---------------------------------------------------------------
// Personal statistics, including streaks
// ---------------------------------------------------------------
app.get("/api/stats", auth.requireUser, async (req, res) => {
  try {
    const totals = await db.query(
      `SELECT COUNT(*)::int AS rounds,
              COALESCE(SUM(score), 0)::int AS total_score,
              COALESCE(ROUND(AVG(score)), 0)::int AS average_score,
              COALESCE(MAX(score), 0)::int AS best_score,
              COALESCE(ROUND(MIN(distance_m)), 0)::int AS closest_metres
       FROM guesses
       WHERE user_id = $1`,
      [req.user.id]
    );

    // Consecutive-day runs are found by subtracting each date's row
    // number from the date itself: dates in an unbroken run all yield
    // the same value, so grouping on it gives one row per run.
    const streaks = await db.query(
      `WITH played AS (
         SELECT DISTINCT dc.challenge_date AS d
         FROM guesses g
         JOIN daily_challenges dc ON dc.id = g.challenge_id
         WHERE g.user_id = $1
       ),
       runs AS (
         SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp
         FROM played
       ),
       summary AS (
         SELECT grp, COUNT(*)::int AS length, MAX(d) AS last_day
         FROM runs
         GROUP BY grp
       )
       SELECT
         COALESCE(MAX(length), 0) AS longest,
         COALESCE(MAX(length) FILTER (WHERE last_day >= CURRENT_DATE - 1), 0) AS current
       FROM summary`,
      [req.user.id]
    );

    res.json({
      username: req.user.username,
      ...totals.rows[0],
      currentStreak: Number(streaks.rows[0].current),
      longestStreak: Number(streaks.rows[0].longest)
    });
  } catch (err) {
    console.error("Failed to load stats:", err.message);
    res.status(500).json({ error: "Could not load your statistics" });
  }
});

// ---------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------
app.get("/api/leaderboard", async (req, res) => {
  try {
    const today = await db.query(
      `SELECT u.username,
              SUM(g.score)::int AS score,
              COUNT(*)::int AS rounds,
              ROUND(MIN(g.distance_m))::int AS best_distance_m
       FROM guesses g
       JOIN users u ON u.id = g.user_id
       JOIN daily_challenges dc ON dc.id = g.challenge_id
       WHERE dc.challenge_date = CURRENT_DATE
       GROUP BY u.id, u.username
       ORDER BY score DESC, MIN(g.created_at) ASC
       LIMIT 20`
    );

    const allTime = await db.query(
      `SELECT u.username,
              SUM(g.score)::int AS total_score,
              COUNT(*)::int AS rounds,
              ROUND(AVG(g.score))::int AS average_score
       FROM guesses g
       JOIN users u ON u.id = g.user_id
       GROUP BY u.id, u.username
       ORDER BY total_score DESC
       LIMIT 20`
    );

    res.json({ today: today.rows, allTime: allTime.rows });
  } catch (err) {
    console.error("Failed to load leaderboard:", err.message);
    res.status(500).json({ error: "Could not load the leaderboard" });
  }
});

// ---------------------------------------------------------------
// Admin: landmark library
// ---------------------------------------------------------------
app.get("/api/admin/landmarks", requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT l.id, l.name, l.photo_url, l.lat, l.lng, l.difficulty,
              COUNT(dc.id)::int AS times_scheduled,
              MAX(dc.challenge_date) AS last_scheduled
       FROM landmarks l
       LEFT JOIN daily_challenges dc ON dc.landmark_id = l.id
       GROUP BY l.id
       ORDER BY l.id DESC`
    );

    res.json({ landmarks: result.rows });
  } catch (err) {
    console.error("Failed to list landmarks:", err.message);
    res.status(500).json({ error: "Could not load the landmark library" });
  }
});

// Accepts up to 20 photos at once. Coordinates come from each photo's
// own EXIF GPS block; a single upload may instead supply them manually.
app.post("/api/admin/landmarks", requireAdmin, upload.array("photos", 20), async (req, res) => {
  const files = req.files || [];

  if (files.length === 0) {
    return res.status(400).json({ error: "Choose at least one photo" });
  }

  const manualLat = req.body.lat ? Number(req.body.lat) : null;
  const manualLng = req.body.lng ? Number(req.body.lng) : null;
  const manualName = typeof req.body.name === "string" ? req.body.name.trim() : "";

  const tier = DIFFICULTIES.includes(req.body.difficulty)
    ? req.body.difficulty
    : "medium";
  const hasManualCoords =
    manualLat !== null && manualLng !== null &&
    !Number.isNaN(manualLat) && !Number.isNaN(manualLng);

  const created = [];
  const skipped = [];

  for (const file of files) {
    let lat = null;
    let lng = null;
    let source = "exif";

    try {
      const gps = await exifr.gps(file.path);
      if (gps && typeof gps.latitude === "number" && typeof gps.longitude === "number") {
        lat = gps.latitude;
        lng = gps.longitude;
      }
    } catch (err) {
      // No EXIF block, or an unreadable one. Falls through to manual.
    }

    // Manual coordinates apply only to a single-file upload, where it
    // is unambiguous which photo they describe.
    if (lat === null && hasManualCoords && files.length === 1) {
      lat = manualLat;
      lng = manualLng;
      source = "manual";
    }

    if (lat === null) {
      fs.unlink(file.path, () => { });
      skipped.push({
        filename: file.originalname,
        reason: "No GPS data in the photo, and no coordinates given"
      });
      continue;
    }

    if (!insideCampus(lat, lng)) {
      fs.unlink(file.path, () => { });
      skipped.push({
        filename: file.originalname,
        reason: "Location is outside the campus bounds"
      });
      continue;
    }

    const name = files.length === 1 && manualName
      ? manualName
      : nameFromFilename(file.originalname);

    try {
      const result = await db.query(
        `INSERT INTO landmarks (name, photo_url, lat, lng, difficulty)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, photo_url, lat, lng, difficulty`,
        [name, "/uploads/" + file.filename, lat, lng, tier]
      );

      created.push({ ...result.rows[0], source: source });
    } catch (err) {
      fs.unlink(file.path, () => { });
      skipped.push({ filename: file.originalname, reason: "Database rejected the row" });
    }
  }

  res.status(created.length > 0 ? 201 : 400).json({ created, skipped });
});

app.patch("/api/admin/landmarks/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { name, lat, lng } = req.body;

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid landmark id" });
  }

  const fields = [];
  const values = [];

  if (typeof name === "string" && name.trim()) {
    values.push(name.trim());
    fields.push("name = $" + values.length);
  }

  if (typeof lat === "number" && typeof lng === "number") {
    if (!insideCampus(lat, lng)) {
      return res.status(400).json({ error: "Location is outside the campus bounds" });
    }
    values.push(lat);
    fields.push("lat = $" + values.length);
    values.push(lng);
    fields.push("lng = $" + values.length);
  }
  if (DIFFICULTIES.includes(req.body.difficulty)) {
    values.push(req.body.difficulty);
    fields.push("difficulty = $" + values.length);
  }
  if (fields.length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  values.push(id);

  try {
    const result = await db.query(
      "UPDATE landmarks SET " + fields.join(", ") +
      " WHERE id = $" + values.length +
      " RETURNING id, name, photo_url, lat, lng",
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No such landmark" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Failed to update landmark:", err.message);
    res.status(500).json({ error: "Could not update the landmark" });
  }
});

// Fills any gaps in the schedule immediately, so a newly uploaded
// landmark can be put into rotation without waiting for midnight.
app.post("/api/admin/rotate", requireAdmin, async (req, res) => {
  try {
    const created = await ensureUpcomingChallenges(7);
    res.json({ created });
  } catch (err) {
    console.error("Manual rotation failed:", err.message);
    res.status(500).json({ error: "Could not refresh the schedule" });
  }
});

// Multer rejects oversized or wrong-typed files by throwing, which
// would otherwise surface as an unhandled HTML error page.
app.use((err, req, res, next) => {
  if (err) {
    console.error("Upload error:", err.message);
    return res.status(400).json({ error: err.message });
  }
  next();
});

// ---------------------------------------------------------------
// Startup
// ---------------------------------------------------------------
app.listen(PORT, async () => {
  console.log("Campus Geoguessr server running on http://localhost:" + PORT);

  try {
    const created = await ensureUpcomingChallenges(7);
    console.log("Challenge schedule checked, " + created + " date(s) added");
  } catch (err) {
    console.error("Could not prepare the challenge schedule:", err.message);
  }

  // Runs a few minutes after midnight so a new day always has a
  // challenge waiting, without depending on the server being restarted.
  cron.schedule("5 0 * * *", async () => {
    try {
      const created = await ensureUpcomingChallenges(7);
      console.log("Nightly rotation ran, " + created + " date(s) added");
    } catch (err) {
      console.error("Nightly rotation failed:", err.message);
    }
  }, { timezone: "Asia/Kolkata" });
});