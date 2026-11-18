import { useState } from "react";
import { api } from "./api";

export default function AuthScreen({ backdropUrl, onSignedIn }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const user = mode === "login"
        ? await api.login({ username, password })
        : await api.register({ username, email, password });
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(mode === "login" ? "register" : "login");
    setError("");
  }

  return (
    <div className="auth-stage">
      {backdropUrl && <img className="auth-backdrop" src={backdropUrl} alt="" />}
      <div className="auth-veil" />

      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="brand-mark">CG</span>
          <span className="brand-text">
            Campus Geoguessr
            <small>Thapar Institute</small>
          </span>
        </div>

        <h1>{mode === "login" ? "Sign in to play" : "Create an account"}</h1>
        <p className="auth-lede">
          One campus landmark every day. One guess each.
        </p>

                <label>
          <span>{mode === "login" ? "Username or email" : "Username"}</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete={mode === "login" ? "username" : "off"}
            placeholder={mode === "register" ? "shown on the leaderboard" : ""}
            required
          />
          {mode === "register" && (
            <small className="field-hint">
              3 to 20 letters, digits or underscores. Not your email.
            </small>
          )}
        </label>

        {mode === "register" && (
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
        )}

        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
        </label>

        {mode === "register" && (
          <p className="auth-hint">At least 8 characters.</p>
        )}

        {error && <div className="auth-error">{error}</div>}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
        </button>

        <button className="auth-switch" type="button" onClick={switchMode}>
          {mode === "login"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}