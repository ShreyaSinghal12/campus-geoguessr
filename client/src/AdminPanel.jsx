import { useEffect, useState } from "react";
import { api, photoSrc } from "./api";

export default function AdminPanel({ onClose }) {
  const [files, setFiles] = useState([]);
  const [name, setName] = useState("");
  const [coords, setCoords] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [library, setLibrary] = useState([]);
  const [difficulty, setDifficulty] = useState("medium");

  useEffect(() => {
    loadLibrary();
  }, []);

  function loadLibrary() {
    api.adminLandmarks()
      .then((data) => setLibrary(data.landmarks))
      .catch((err) => setError(err.message));
  }

  // Google Maps copies coordinates as "30.353912, 76.368447", so that
  // exact string is what this accepts.
  function parseCoords(text) {
    const match = text.trim().match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
    if (!match) return null;
    return { lat: Number(match[1]), lng: Number(match[3]) };
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || files.length === 0) return;

    setBusy(true);
    setError("");
    setReport(null);

    const form = new FormData();
    for (const file of files) form.append("photos", file);
    form.append("difficulty", difficulty);

    if (files.length === 1) {
      if (name.trim()) form.append("name", name.trim());

      if (coords.trim()) {
        const parsed = parseCoords(coords);
        if (!parsed) {
          setError("Coordinates must look like 30.353912, 76.368447");
          setBusy(false);
          return;
        }
        form.append("lat", String(parsed.lat));
        form.append("lng", String(parsed.lng));
      }
    }

    try {
      const result = await api.adminUpload(form);
      setReport(result);
      setFiles([]);
      setName("");
      setCoords("");
      loadLibrary();
    } catch (err) {
      setError(err.message);
      if (err.data) setReport(err.data);
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    try {
      const result = await api.adminRotate();
      setError("");
      setReport({ created: [], skipped: [], rotated: result.created });
    } catch (err) {
      setError(err.message);
    }
  }

  const single = files.length === 1;

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal admin" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Landmark library</h2>
          <button className="modal-close" onClick={onClose} title="Close">x</button>
        </div>

        <form onSubmit={submit}>
          <label className="file-drop">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files))}
            />
            <strong>
              {files.length === 0
                ? "Choose photos"
                : files.length + " photo" + (files.length === 1 ? "" : "s") + " selected"}
            </strong>
            <small>
              Phone photos carry GPS coordinates, which are read automatically.
            </small>
          </label>

          {files.length > 1 && (
            <p className="admin-note">
              Bulk upload: names come from the filenames, and every photo must
              carry GPS data. Rename anything that needs it afterwards.
            </p>
          )}

          {single && (
            <>
              <label>
                <span>Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Taken from the filename if left blank"
                />
              </label>

              <label>
                <span>Coordinates (only if the photo has no GPS)</span>
                <input
                  value={coords}
                  onChange={(e) => setCoords(e.target.value)}
                  placeholder="30.353912, 76.368447"
                />
                <small className="field-hint">
                  Right-click the spot in Google Maps and paste what it copies.
                </small>
              </label>
            </>
          )}
          <label>
            <span>Difficulty</span>
            <div className="tabs">
              {["easy", "medium", "hard"].map((tier) => (
                <button
                  key={tier}
                  type="button"
                  className={difficulty === tier ? "tab active" : "tab"}
                  onClick={() => setDifficulty(tier)}
                >
                  {tier}
                </button>
              ))}
            </div>
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-submit" type="submit" disabled={busy || files.length === 0}>
            {busy ? "Uploading..." : "Add to library"}
          </button>
        </form>

        {report && (
          <div className="report">
            {report.rotated !== undefined && (
              <p className="report-ok">
                Schedule refreshed, {report.rotated} date(s) added.
              </p>
            )}

            {report.created && report.created.length > 0 && (
              <p className="report-ok">
                Added {report.created.length}:{" "}
                {report.created.map((c) => c.name).join(", ")}
              </p>
            )}

            {report.skipped && report.skipped.length > 0 && (
              <ul className="report-bad">
                {report.skipped.map((s, i) => (
                  <li key={i}>
                    <strong>{s.filename}</strong> - {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="library-head">
          <h3>{library.length} landmark{library.length === 1 ? "" : "s"} in rotation</h3>
          <button className="tab" type="button" onClick={rotate}>
            Refresh schedule
          </button>
        </div>

        <div className="library">
          {library.map((item) => (
            <div className="library-item" key={item.id}>
              <img src={photoSrc(item.photo_url)} alt="" />
              <div>
                <strong>{item.name}</strong>
                <small>
                  {Number(item.lat).toFixed(6)}, {Number(item.lng).toFixed(6)}
                </small>
                <small>
                  {item.times_scheduled === 0
                    ? "Never used"
                    : "Used " + item.times_scheduled + " time(s), last " +
                    String(item.last_scheduled).slice(0, 10)}
                </small>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}