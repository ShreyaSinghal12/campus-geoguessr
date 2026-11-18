// Single place where the API base URL and the credential policy live.
// credentials: "include" is what sends the session cookie across the
// port boundary between Vite (5173) and Express (4000).

const API = "http://localhost:4000";

async function request(path, options) {
  const response = await fetch(API + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });

  return handle(response);
}

// Multipart uploads must not carry a Content-Type header: the browser
// sets it itself, including the boundary marker.
async function upload(path, formData) {
  const response = await fetch(API + path, {
    method: "POST",
    credentials: "include",
    body: formData
  });

  return handle(response);
}

async function handle(response) {
  let data = null;
  try {
    data = await response.json();
  } catch (err) {
    data = null;
  }

  if (!response.ok) {
    const message = data && data.error
      ? data.error
      : "Request failed (" + response.status + ")";
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

// Uploaded photos are served by the API, not by Vite, so they need the
// API origin prefixed. Anything in client/public is left alone.
export function photoSrc(url) {
  if (!url) return "";
  if (url.startsWith("/uploads/")) return API + url;
  return url;
}

export const api = {
  me: () => request("/api/auth/me"),
  register: (body) => request("/api/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body) => request("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  today: () => request("/api/challenge/today"),
  guess: (body) => request("/api/guess", { method: "POST", body: JSON.stringify(body) }),
  stats: () => request("/api/stats"),
  leaderboard: () => request("/api/leaderboard"),
  adminLandmarks: () => request("/api/admin/landmarks"),
  adminUpload: (formData) => upload("/api/admin/landmarks", formData),
  adminUpdate: (id, body) => request("/api/admin/landmarks/" + id, { method: "PATCH", body: JSON.stringify(body) }),
  adminRotate: () => request("/api/admin/rotate", { method: "POST" })
};