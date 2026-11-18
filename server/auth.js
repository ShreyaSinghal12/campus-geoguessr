// Password hashing and session tokens.
// Tokens are issued as httpOnly cookies so that page scripts cannot read
// them, which limits the damage an XSS flaw could do.

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const COOKIE_NAME = "cg_token";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function issueToken(res, user) {
  const token = jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS }
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TOKEN_TTL_SECONDS * 1000
  });
}

function clearToken(res) {
  res.clearCookie(COOKIE_NAME);
}

// Attaches req.user when a valid token is present, and does nothing
// otherwise. Used on routes that behave differently when signed in.
function readUser(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];

  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      // Expired or tampered token: treat the caller as a guest.
      req.user = null;
    }
  } else {
    req.user = null;
  }

  next();
}

// Rejects the request when nobody is signed in.
function requireUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "You need to sign in first" });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  issueToken,
  clearToken,
  readUser,
  requireUser
};