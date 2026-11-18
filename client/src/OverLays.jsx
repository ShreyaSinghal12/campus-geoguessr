import { useEffect, useState } from "react";
import { api } from "./api";

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} title="Close">x</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatsPanel({ onClose }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.stats().then(setStats).catch((err) => setError(err.message));
  }, []);

  return (
    <Modal title="Your statistics" onClose={onClose}>
      {error && <div className="modal-error">{error}</div>}

      {!stats && !error && <div className="modal-loading">Loading...</div>}

      {stats && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <strong>{stats.rounds}</strong>
              <small>Rounds</small>
            </div>
            <div className="stat">
              <strong>{stats.currentStreak}</strong>
              <small>Current streak</small>
            </div>
            <div className="stat">
              <strong>{stats.longestStreak}</strong>
              <small>Longest streak</small>
            </div>
            <div className="stat">
              <strong>{stats.average_score}</strong>
              <small>Average score</small>
            </div>
            <div className="stat">
              <strong>{stats.best_score}</strong>
              <small>Best score</small>
            </div>
            <div className="stat">
              <strong>{stats.closest_metres} m</strong>
              <small>Closest guess</small>
            </div>
          </div>

          <p className="modal-foot">
            Total points scored: {stats.total_score}
          </p>
        </>
      )}
    </Modal>
  );
}

export function LeaderboardPanel({ username, onClose }) {
  const [board, setBoard] = useState(null);
  const [tab, setTab] = useState("today");
  const [error, setError] = useState("");

  useEffect(() => {
    api.leaderboard().then(setBoard).catch((err) => setError(err.message));
  }, []);

  const rows = board ? (tab === "today" ? board.today : board.allTime) : [];

  return (
    <Modal title="Leaderboard" onClose={onClose}>
      <div className="tabs">
        <button
          className={tab === "today" ? "tab active" : "tab"}
          onClick={() => setTab("today")}
        >
          Today
        </button>
        <button
          className={tab === "allTime" ? "tab active" : "tab"}
          onClick={() => setTab("allTime")}
        >
          All time
        </button>
      </div>

      {error && <div className="modal-error">{error}</div>}

      {!board && !error && <div className="modal-loading">Loading...</div>}

      {board && rows.length === 0 && (
        <div className="modal-loading">
          {tab === "today" ? "Nobody has played today yet." : "No rounds played yet."}
        </div>
      )}

      {board && rows.length > 0 && (
        <table className="board">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Rounds</th>
              <th>{tab === "today" ? "Day total" : "Total"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.username + index}
                className={row.username === username ? "you" : ""}
              >
                <td>{index + 1}</td>
                <td>{row.username}</td>
                <td>{tab === "today" ? row.rounds + "/3" : row.rounds}</td>
                <td className="score-col">
                  {tab === "today" ? row.score : row.total_score}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}