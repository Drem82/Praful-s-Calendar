/* Praful's desk - GGF shared queue
   Globals expected on window: React, ReactDOM, firebase, FIREBASE_CONFIG
   No build tool needed by the user: edit config.js only. */

const { useState, useEffect, useRef, useCallback } = React;

/* ---------- brand ---------- */
const NAVY = "#112743";
const CREAM = "#F4F1EA";
const AMBER = "#E2A33C";
const SECTIONS = [
  { id: "signoff", label: "Sign off", blurb: "Ready to go. Just needs Praful's yes." },
  { id: "steer", label: "Needs a steer", blurb: "A draft or approach where we want his reaction before going further." },
  { id: "awareness", label: "For his awareness", blurb: "Just so he knows. No response needed." },
];
const MAX_FILE = 700 * 1024; // keeps the stored file under the Firestore document limit

/* ---------- dates ---------- */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}
function parseISO(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysUntil(iso) {
  const d = parseISO(iso);
  if (!d) return null;
  return Math.round((d - startOfToday()) / 86400000);
}
function deadlineLabel(iso) {
  const n = daysUntil(iso);
  if (n === null) return null;
  if (n < 0) return n === -1 ? "Overdue by 1 day" : "Overdue by " + Math.abs(n) + " days";
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  const d = parseISO(iso);
  return "Due " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function isUrgent(iso) {
  const n = daysUntil(iso);
  return n !== null && n <= 1;
}
function formatWhen(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* ---------- note parser (on device, no key, no server) ---------- */
const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
const DAYS = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };

function nextWeekday(targetDow) {
  const t = startOfToday();
  let diff = (targetDow - t.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  const d = new Date(t);
  d.setDate(t.getDate() + diff);
  return d;
}
function findDeadline(text) {
  const lower = text.toLowerCase();
  // explicit iso
  let m = /\b(\d{4}-\d{2}-\d{2})\b/.exec(lower);
  if (m) return m[1];
  // dd/mm or dd/mm/yyyy or dd.mm
  m = /\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/.exec(lower);
  if (m) {
    const day = Number(m[1]); const mon = Number(m[2]) - 1;
    let yr = m[3] ? Number(m[3]) : startOfToday().getFullYear();
    if (yr < 100) yr += 2000;
    if (mon >= 0 && mon < 12 && day >= 1 && day <= 31) return toISO(new Date(yr, mon, day));
  }
  // "14 March" or "March 14" or "14th of march"
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.exec(lower);
  if (!m) {
    const m2 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(lower);
    if (m2) m = [m2[0], m2[2], m2[1]];
  }
  if (m) {
    const day = Number(m[1]); const mon = MONTHS[m[2].slice(0, 3)];
    let d = new Date(startOfToday().getFullYear(), mon, day);
    if (d < startOfToday()) d = new Date(startOfToday().getFullYear() + 1, mon, day);
    return toISO(d);
  }
  if (/\btoday\b/.test(lower)) return toISO(startOfToday());
  if (/\btomorrow\b/.test(lower)) { const d = startOfToday(); d.setDate(d.getDate() + 1); return toISO(d); }
  if (/\b(eow|end of (the )?week)\b/.test(lower)) return toISO(nextWeekday(5));
  // weekday names
  const dm = /\b(?:by|before|on|next|this)?\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*/.exec(lower);
  if (dm) return toISO(nextWeekday(DAYS[dm[1]]));
  return null;
}
function findSection(lower) {
  if (/\b(sign[\s-]?off|signoff|approve|approval|final draft|ready to go|ok to send|okay to send|green ?light|going out|under his name)\b/.test(lower)) return "signoff";
  if (/\b(fyi|for info|aware|awareness|heads? up|no action|just so|note that|for the record)\b/.test(lower)) return "awareness";
  if (/\b(steer|reaction|thoughts|input|direction|take a look|feedback|advice|sense ?check|sanity ?check|his view|what he thinks)\b/.test(lower)) return "steer";
  return "steer";
}
function findFrom(text) {
  let m = /\bfrom\s+([A-Za-z][A-Za-z'-]+)\b/i.exec(text);
  if (m) return cap(m[1]);
  m = /[-,]\s*([A-Z][a-z'-]+)\s*$/.exec(text.trim());
  if (m) return cap(m[1]);
  return "";
}
function findMaterial(text) {
  let m = /\bhttps?:\/\/[^\s,;)]+/i.exec(text);
  if (m) return m[0];
  m = /\b(?:it'?s?\s+in|in\s+the|see\s+the)\s+([a-z0-9 ]+?\b(?:doc|document|folder|drive|sheet|deck|file|email|thread|channel))\b/i.exec(text);
  if (m) return cap(m[1].trim());
  return "";
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function makeTitle(text) {
  let seg = text.split(/[,.;]/)[0] || text;
  seg = seg.replace(/\b(draft|the|a|an|please|pls|can you|could you)\b/gi, " ");
  seg = seg.replace(/\b(ready|done|drafted|prepared|finished|complete|completed|is ready)\b/gi, " ");
  seg = seg.replace(/\s+/g, " ").trim();
  if (!seg) seg = text.trim();
  if (seg.length > 70) seg = seg.slice(0, 67).trim() + "...";
  return cap(seg);
}
function needFor(section, text) {
  const m = /\bneeds?\s+(?:praful\s+)?(?:to\s+)?([a-z][a-z ]{2,40}?)(?:\s+(?:before|by|on|for|,|\.|$))/i.exec(text);
  if (m) return cap(m[1].trim());
  if (section === "signoff") return "Sign off";
  if (section === "steer") return "A steer on the approach";
  return "No response needed";
}
function parseNote(text) {
  const lower = text.toLowerCase();
  const section = findSection(lower);
  return {
    title: makeTitle(text),
    section,
    need: needFor(section, text),
    deadline: findDeadline(text) || "",
    material: findMaterial(text),
    from: findFrom(text),
  };
}

/* ---------- storage layer ---------- */
function localStore() {
  const KEY = "ggf_prafuls_desk_items";
  const FKEY = "ggf_prafuls_desk_files";
  const listeners = [];
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } };
  const write = (arr) => { localStorage.setItem(KEY, JSON.stringify(arr)); listeners.forEach((f) => f(arr)); };
  const readFiles = () => { try { return JSON.parse(localStorage.getItem(FKEY) || "{}"); } catch (e) { return {}; } };
  const writeFiles = (o) => localStorage.setItem(FKEY, JSON.stringify(o));
  const id = () => "i" + Date.now() + Math.random().toString(36).slice(2, 6);
  return {
    mode: "local",
    subscribe(cb) { listeners.push(cb); cb(read()); return () => {}; },
    async add(item) { const arr = read(); arr.push({ ...item, id: id() }); write(arr); },
    async update(itemId, patch) { write(read().map((i) => (i.id === itemId ? { ...i, ...patch } : i))); },
    async remove(itemId) { write(read().filter((i) => i.id !== itemId)); },
    async saveFile(dataUrl, name, type, size) {
      const files = readFiles(); const fid = id();
      files[fid] = { data: dataUrl, name, type, size }; writeFiles(files); return fid;
    },
    async getFile(fid) { return readFiles()[fid] || null; },
  };
}
function firebaseStore(db) {
  const items = db.collection("items");
  const files = db.collection("files");
  return {
    mode: "shared",
    subscribe(cb) {
      return items.onSnapshot((snap) => {
        const arr = []; snap.forEach((d) => arr.push({ id: d.id, ...d.data() })); cb(arr);
      });
    },
    async add(item) { await items.add(item); },
    async update(itemId, patch) { await items.doc(itemId).update(patch); },
    async remove(itemId) { await items.doc(itemId).delete(); },
    async saveFile(dataUrl, name, type, size) {
      const ref = await files.add({ data: dataUrl, name, type, size }); return ref.id;
    },
    async getFile(fid) { const d = await files.doc(fid).get(); return d.exists ? d.data() : null; },
  };
}
async function initStore() {
  const cfg = window.FIREBASE_CONFIG;
  const ready = cfg && cfg.apiKey && cfg.projectId && !String(cfg.apiKey).startsWith("PASTE");
  if (ready && window.firebase) {
    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      const db = firebase.firestore();
      const ref = db.collection("__healthcheck").doc("ping");
      await ref.set({ t: Date.now() });
      await ref.get();
      await ref.delete();
      return firebaseStore(db);
    } catch (e) {
      console.warn("Shared backend round trip failed, using this device only.", e);
      return localStore();
    }
  }
  return localStore();
}

/* ---------- small UI pieces ---------- */
function Banner({ mode }) {
  if (mode === "shared") {
    return (
      <div className="banner banner-ok">
        Shared and live. Everyone on the team sees the same desk.
      </div>
    );
  }
  return (
    <div className="banner banner-warn">
      Working on this device only. The shared backend is not connected yet, so what you add here will not reach the team. See the README to switch it on.
    </div>
  );
}

function FileChip({ store, fileId, fileName }) {
  const [busy, setBusy] = useState(false);
  if (!fileId) return null;
  const open = async () => {
    setBusy(true);
    try {
      const f = await store.getFile(fileId);
      if (!f) { setBusy(false); return; }
      const a = document.createElement("a");
      a.href = f.data; a.download = f.name || fileName || "file";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { /* ignore */ }
    setBusy(false);
  };
  return (
    <button className="filechip" onClick={open} disabled={busy}>
      {busy ? "Opening..." : "File: " + (fileName || "attachment")}
    </button>
  );
}

function FilePicker({ value, onPicked, onError }) {
  const ref = useRef(null);
  const pick = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > MAX_FILE) {
      onError("That file is over 700KB. For bigger files, paste a link in the material field instead.");
      ref.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onPicked({ data: reader.result, name: file.name, type: file.type, size: file.size });
    reader.onerror = () => onError("Could not read that file. Try again.");
    reader.readAsDataURL(file);
  };
  return (
    <div className="filepicker">
      <input ref={ref} type="file" onChange={pick} />
      {value && value.name ? <span className="filepicker-name">Ready: {value.name}</span> : null}
    </div>
  );
}

/* ---------- add form ---------- */
function AddForm({ store, onError }) {
  const [raw, setRaw] = useState("");
  const [draft, setDraft] = useState(null);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const read = () => {
    const t = raw.trim();
    if (!t) return;
    setDraft(parseNote(t));
  };
  const commit = async () => {
    setSaving(true);
    try {
      let fileId = null, fileName = null, fileType = null, fileSize = null;
      if (file) {
        fileId = await store.saveFile(file.data, file.name, file.type, file.size);
        fileName = file.name; fileType = file.type; fileSize = file.size;
      }
      await store.add({
        title: draft.title || "Untitled",
        section: draft.section,
        need: draft.need || "",
        deadline: draft.deadline || null,
        material: draft.material || "",
        from: draft.from || "",
        createdAt: Date.now(),
        status: "waiting",
        response: null,
        fileId, fileName, fileType, fileSize,
      });
      setRaw(""); setDraft(null); setFile(null);
    } catch (e) {
      onError("That did not save. Check your connection and try again.");
    }
    setSaving(false);
  };

  return (
    <div className="card addcard">
      <label className="addlabel" htmlFor="note">Add to the desk</label>
      <textarea
        id="note"
        className="noteinput"
        rows={3}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Type a quick note. For example: draft welfare press release ready, needs Praful sign off before Thursday, its in the launch doc, from Billie"
      />
      {!draft ? (
        <button className="btn btn-primary" onClick={read} disabled={!raw.trim()}>Read it</button>
      ) : (
        <div className="review">
          <p className="reviewhint">Check this looks right, then add it.</p>
          <Field label="Title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
          <div className="field">
            <span className="fieldlabel">Section</span>
            <div className="seg">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  className={"segbtn" + (draft.section === s.id ? " segbtn-on" : "")}
                  onClick={() => setDraft({ ...draft, section: s.id })}
                >{s.label}</button>
              ))}
            </div>
          </div>
          <Field label="What Praful needs to do" value={draft.need} onChange={(v) => setDraft({ ...draft, need: v })} />
          <div className="field">
            <span className="fieldlabel">Deadline</span>
            <input type="date" className="textinput" value={draft.deadline}
              onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} />
          </div>
          <Field label="Material or link" value={draft.material} onChange={(v) => setDraft({ ...draft, material: v })} />
          <Field label="From" value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} />
          <div className="field">
            <span className="fieldlabel">Attach a file (optional)</span>
            <FilePicker value={file} onPicked={setFile} onError={onError} />
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={commit} disabled={saving}>
              {saving ? "Adding..." : "Add to desk"}
            </button>
            <button className="btn btn-quiet" onClick={() => { setDraft(null); setFile(null); }} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div className="field">
      <span className="fieldlabel">{label}</span>
      <input className="textinput" value={value || ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* ---------- item card ---------- */
function ItemCard({ store, item, onError }) {
  const [editing, setEditing] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const [reason, setReason] = useState("");
  const [steer, setSteer] = useState("");

  const patch = async (p) => { try { await store.update(item.id, p); } catch (e) { onError("That did not save. Try again."); } };
  const del = async () => { try { await store.remove(item.id); } catch (e) { onError("Could not delete that. Try again."); } };

  const respond = (resp) => patch({ status: "actioned", response: { ...resp, at: Date.now() } });

  if (editing) return <EditCard store={store} item={item} onDone={() => setEditing(false)} onError={onError} />;

  const urgent = item.status === "waiting" && isUrgent(item.deadline);
  const dl = deadlineLabel(item.deadline);

  return (
    <div className={"card item" + (item.status === "actioned" ? " item-done" : "") + (urgent ? " item-urgent" : "")}>
      <div className="itemtop">
        <h4 className="itemtitle">{item.title}</h4>
        {dl ? <span className={"pill" + (urgent ? " pill-urgent" : "")}>{dl}</span> : null}
      </div>
      {item.need ? <p className="itemneed">{item.need}</p> : null}
      {item.material ? (
        /^https?:\/\//i.test(item.material)
          ? <a className="itemlink" href={item.material} target="_blank" rel="noreferrer">{item.material}</a>
          : <p className="itemmaterial">{item.material}</p>
      ) : null}
      <FileChip store={store} fileId={item.fileId} fileName={item.fileName} />

      {item.status === "actioned" && item.response ? (
        <div className="response">
          <span className="responselabel">{responseHeading(item)}</span>
          {item.response.text ? <span className="responsetext">{item.response.text}</span> : null}
          <span className="responsewhen">{formatWhen(item.response.at)}</span>
        </div>
      ) : (
        <div className="controls">
          {item.section === "signoff" && (
            notYet ? (
              <div className="reasonbox">
                <input className="textinput" placeholder="Quick reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="row">
                  <button className="btn btn-primary" onClick={() => respond({ type: "notyet", text: reason })} disabled={!reason.trim()}>Save</button>
                  <button className="btn btn-quiet" onClick={() => setNotYet(false)}>Back</button>
                </div>
              </div>
            ) : (
              <div className="row">
                <button className="btn btn-primary" onClick={() => respond({ type: "signed" })}>Signed off</button>
                <button className="btn btn-outline" onClick={() => setNotYet(true)}>Not yet</button>
              </div>
            )
          )}
          {item.section === "steer" && (
            <div className="reasonbox">
              <input className="textinput" placeholder="One line steer" value={steer} onChange={(e) => setSteer(e.target.value)} />
              <button className="btn btn-primary" onClick={() => respond({ type: "steer", text: steer })} disabled={!steer.trim()}>Add steer</button>
            </div>
          )}
          {item.section === "awareness" && (
            <button className="btn btn-primary" onClick={() => respond({ type: "ack" })}>Got it</button>
          )}
        </div>
      )}

      <div className="itemfoot">
        <span className="byline">{item.from ? "Added by " + item.from : "Added"}{item.createdAt ? ", " + formatWhen(item.createdAt) : ""}</span>
        <span className="actions">
          {item.status === "actioned" ? <button className="link" onClick={() => patch({ status: "waiting", response: null })}>Move back to waiting</button> : null}
          <button className="link" onClick={() => setEditing(true)}>Edit</button>
          <button className="link link-del" onClick={del}>Delete</button>
        </span>
      </div>
    </div>
  );
}

function responseHeading(item) {
  const r = item.response;
  if (r.type === "signed") return "Signed off";
  if (r.type === "notyet") return "Not yet:";
  if (r.type === "steer") return "Steer:";
  if (r.type === "ack") return "Seen";
  return "Done";
}

function EditCard({ store, item, onDone, onError }) {
  const [f, setF] = useState({
    title: item.title || "", section: item.section, need: item.need || "",
    deadline: item.deadline || "", material: item.material || "", from: item.from || "",
  });
  const [file, setFile] = useState(null);
  const save = async () => {
    try {
      const p = { ...f, deadline: f.deadline || null };
      if (file) { p.fileId = await store.saveFile(file.data, file.name, file.type, file.size); p.fileName = file.name; p.fileType = file.type; p.fileSize = file.size; }
      await store.update(item.id, p); onDone();
    } catch (e) { onError("That did not save. Try again."); }
  };
  return (
    <div className="card editcard">
      <Field label="Title" value={f.title} onChange={(v) => setF({ ...f, title: v })} />
      <div className="field">
        <span className="fieldlabel">Section</span>
        <div className="seg">
          {SECTIONS.map((s) => (
            <button key={s.id} className={"segbtn" + (f.section === s.id ? " segbtn-on" : "")} onClick={() => setF({ ...f, section: s.id })}>{s.label}</button>
          ))}
        </div>
      </div>
      <Field label="What Praful needs to do" value={f.need} onChange={(v) => setF({ ...f, need: v })} />
      <div className="field">
        <span className="fieldlabel">Deadline</span>
        <input type="date" className="textinput" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
      </div>
      <Field label="Material or link" value={f.material} onChange={(v) => setF({ ...f, material: v })} />
      <Field label="From" value={f.from} onChange={(v) => setF({ ...f, from: v })} />
      <div className="field">
        <span className="fieldlabel">Replace file (optional)</span>
        <FilePicker value={file} onPicked={setFile} onError={onError} />
        {item.fileName && !file ? <span className="filepicker-name">Current: {item.fileName}</span> : null}
      </div>
      <div className="row">
        <button className="btn btn-primary" onClick={save}>Save changes</button>
        <button className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

/* ---------- section ---------- */
function sortWaiting(a, b) {
  const da = daysUntil(a.deadline); const db_ = daysUntil(b.deadline);
  if (da === null && db_ === null) return (a.createdAt || 0) - (b.createdAt || 0);
  if (da === null) return 1;
  if (db_ === null) return -1;
  return da - db_;
}
function Section({ def, items, store, onError }) {
  const mine = items.filter((i) => i.section === def.id && i.status === "waiting").sort(sortWaiting);
  return (
    <section className="section">
      <div className="sectionhead">
        <h3 className="sectiontitle">{def.label}</h3>
        <span className="sectioncount">{mine.length}</span>
      </div>
      <p className="sectionblurb">{def.blurb}</p>
      {mine.length === 0
        ? <p className="empty">Nothing waiting here.</p>
        : mine.map((i) => <ItemCard key={i.id} store={store} item={i} onError={onError} />)}
    </section>
  );
}

/* ---------- recently actioned ---------- */
function Recent({ items, store, onError }) {
  const [open, setOpen] = useState(false);
  const done = items.filter((i) => i.status === "actioned").sort((a, b) => (b.response && b.response.at || 0) - (a.response && a.response.at || 0));
  if (done.length === 0) return null;
  return (
    <section className="recent">
      <button className="recenthead" onClick={() => setOpen(!open)}>
        <span>Recently actioned</span>
        <span className="sectioncount">{done.length}{open ? "  hide" : "  show"}</span>
      </button>
      {open ? done.map((i) => <ItemCard key={i.id} store={store} item={i} onError={onError} />) : null}
    </section>
  );
}

/* ---------- app ---------- */
function App() {
  const [store, setStore] = useState(null);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub = () => {};
    initStore().then((s) => {
      setStore(s);
      setLoading(false);
      try { unsub = s.subscribe((arr) => setItems(arr)); }
      catch (e) { setItems([]); }
    });
    return () => unsub();
  }, []);

  if (loading || !store) {
    return <div className="loading">Opening the desk...</div>;
  }

  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand">
          <span className="mark">GGF</span>
          <div className="brandtext">
            <span className="brandname">Good Growth Foundation</span>
            <span className="brandsub">Praful's desk</span>
          </div>
        </div>
      </header>

      <Banner mode={store.mode} />
      {err ? (
        <div className="banner banner-error">
          {err}
          <button className="btn btn-small" onClick={() => setErr("")}>Dismiss</button>
        </div>
      ) : null}

      <p className="lede">What needs Praful. Add anything that needs his sign off, his steer, or just his eyes. He works through it on his days in.</p>

      <AddForm store={store} onError={setErr} />

      {SECTIONS.map((def) => (
        <Section key={def.id} def={def} items={items} store={store} onError={setErr} />
      ))}

      <Recent items={items} store={store} onError={setErr} />

      <footer className="foot">Good Growth Foundation</footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
