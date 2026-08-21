import { useEffect, useMemo, useState } from "react";
import { copyText } from "./services/clipboard";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  LANES,
  type ExportFormat,
  type Lane,
  type PatternDocument,
  type PatternRow,
} from "./types";

const STORAGE_KEY = "PATTERNMANIA";
const INITIAL_ROWS = 12;
const MAX_ROWS = 200;
const MAX_HISTORY = 100;

const LANE_META: Record<
  Lane,
  { short: string; label: string; key: string }
> = {
  green: { short: "V", label: "Vert", key: "1" },
  red: { short: "R", label: "Rouge", key: "2" },
  yellow: { short: "J", label: "Jaune", key: "3" },
  blue: { short: "B", label: "Bleu", key: "4" },
  orange: { short: "O", label: "Orange", key: "5" },
};

const LANE_EMOJI: Record<Lane, string> = {
  green: "🟢",
  red: "🔴",
  yellow: "🟡",
  blue: "🔵",
  orange: "🟠",
};

const INVISIBLE_SLOT = "\u2800";
const OPEN_BAR = "━━━━━━━━━━━━━━━━━━━━";

interface HistoryState {
  past: PatternDocument[];
  current: PatternDocument;
  future: PatternDocument[];
}

function createId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function createRow(): PatternRow {
  return {
    id: createId(),
    open: false,
    lanes: {
      green: false,
      red: false,
      yellow: false,
      blue: false,
      orange: false,
    },
  };
}

function createDocument(rowCount = INITIAL_ROWS): PatternDocument {
  return {
    version: 1,
    title: "Mon pattern",
    rows: Array.from({ length: rowCount }, createRow),
  };
}

function cloneDocument(document: PatternDocument): PatternDocument {
  return structuredClone(document);
}

function rowHasNotes(row: PatternRow): boolean {
  return row.open || LANES.some((lane) => row.lanes[lane]);
}

function sanitizeDocument(value: unknown): PatternDocument {
  if (!value || typeof value !== "object") return createDocument();
  const candidate = value as Partial<PatternDocument>;
  if (!Array.isArray(candidate.rows) || candidate.rows.length === 0) {
    return createDocument();
  }

  const rows = candidate.rows.slice(0, MAX_ROWS).map((raw) => {
    const source = raw as Partial<PatternRow>;
    const lanes = source.lanes ?? ({} as PatternRow["lanes"]);
    return {
      id: typeof source.id === "string" ? source.id : createId(),
      open: Boolean(source.open),
      lanes: {
        green: Boolean(lanes.green),
        red: Boolean(lanes.red),
        yellow: Boolean(lanes.yellow),
        blue: Boolean(lanes.blue),
        orange: Boolean(lanes.orange),
      },
    };
  });

  return {
    version: 1,
    title:
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.slice(0, 80)
        : "Mon pattern",
    rows,
  };
}

function loadStoredDocument(): PatternDocument {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeDocument(JSON.parse(raw)) : createDocument();
  } catch {
    return createDocument();
  }
}

function buildExample(): PatternDocument {
  const document = createDocument(14);
  const activate = (rowIndex: number, lanes: Lane[], open = false) => {
    const row = document.rows[rowIndex];
    if (!row) return;
    row.open = open;
    lanes.forEach((lane) => {
      row.lanes[lane] = true;
    });
  };

  activate(0, ["green"]);
  activate(1, ["red"]);
  activate(2, ["yellow"]);
  activate(3, ["red", "yellow"]);
  activate(5, ["blue"]);
  activate(6, ["green", "orange"]);
  activate(8, ["red", "blue"], true);
  activate(10, ["yellow", "blue", "orange"]);
  activate(12, ["green", "red"]);

  return { ...document, title: "Exemple de pattern" };
}

function wrapDiscord(text: string, enabled: boolean): string {
  return enabled ? `\`\`\`\n${text}\n\`\`\`` : text;
}

function buildLaneCells(row: PatternRow, showEmptyDots: boolean): string {
  const empty = showEmptyDots ? "·" : INVISIBLE_SLOT;
  return LANES.map((lane) => (row.lanes[lane] ? LANE_EMOJI[lane] : empty)).join(
    "  ",
  );
}

function exportVisual(
  document: PatternDocument,
  keepSilences: boolean,
  showNumbers: boolean,
  showEmptyDots: boolean,
): string {
  const rows = keepSilences
    ? document.rows
    : document.rows.filter(rowHasNotes);

  const title = document.title.trim();
  const lines: string[] = [];
  if (title) lines.push(title, "");

  const guidePrefix = showNumbers ? "   │ " : "";
  lines.push(`${guidePrefix}V   R   J   B   O`);
  lines.push(`${guidePrefix}${"─".repeat(20)}`);

  rows.forEach((row, index) => {
    const number = showNumbers
      ? `${String(index + 1).padStart(2, "0")} │ `
      : "";
    const continuation = showNumbers ? "   │ " : "";

    if (row.open) {
      lines.push(`${number}${OPEN_BAR}`);

      if (LANES.some((lane) => row.lanes[lane])) {
        lines.push(`${continuation}${buildLaneCells(row, showEmptyDots)}`);
      }
      return;
    }

    lines.push(`${number}${buildLaneCells(row, showEmptyDots)}`);
  });

  return lines.join("\n");
}

function exportCompact(
  document: PatternDocument,
  keepSilences: boolean,
): string {
  const title = document.title.trim();
  const lines: string[] = title ? [title, ""] : [];

  document.rows.forEach((row) => {
    const coloredNotes = LANES.filter((lane) => row.lanes[lane]).map(
      (lane) => LANE_EMOJI[lane],
    );

    if (row.open) {
      lines.push(OPEN_BAR);
      if (coloredNotes.length > 0) {
        lines.push(coloredNotes.join(" + "));
      }
    } else if (coloredNotes.length > 0) {
      lines.push(coloredNotes.join(" + "));
    } else if (keepSilences) {
      lines.push("—");
    }
  });

  return lines.join("\n");
}

function App() {
  const [history, setHistory] = useState<HistoryState>(() => ({
    past: [],
    current: loadStoredDocument(),
    future: [],
  }));
  const [selectedRowId, setSelectedRowId] = useState<string | null>(
    history.current.rows[0]?.id ?? null,
  );
  const [format, setFormat] = useState<ExportFormat>("visual");
  const [keepSilences, setKeepSilences] = useState(true);
  const [showNumbers, setShowNumbers] = useState(true);
  const [showEmptyDots, setShowEmptyDots] = useState(true);
  const [wrapCodeBlock, setWrapCodeBlock] = useState(true);
  const [status, setStatus] = useState("Prêt à créer ton pattern.");
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updateProgress, setUpdateProgress] = useState<{ downloaded: number; total: number } | null>(null);

  useEffect(() => {
    checkForUpdate()
      .then((update) => {
        if (update?.available) setAvailableUpdate(update);
      })
      .catch(() => {});
  }, []);

  async function installUpdate() {
    if (!availableUpdate) return;
    let downloaded = 0;
    let total = 0;
    await availableUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") downloaded += event.data.chunkLength;
      setUpdateProgress({ downloaded, total });
    });
    await relaunch();
  }

  const document = history.current;

  const exportedBody = useMemo(() => {
    return format === "visual"
      ? exportVisual(document, keepSilences, showNumbers, showEmptyDots)
      : exportCompact(document, keepSilences);
  }, [document, format, keepSilences, showNumbers, showEmptyDots]);

  const exportedText = useMemo(
    () => wrapDiscord(exportedBody, wrapCodeBlock),
    [exportedBody, wrapCodeBlock],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  }, [document]);

  function commit(next: PatternDocument, message?: string) {
    setHistory((previous) => ({
      past: [...previous.past, cloneDocument(previous.current)].slice(
        -MAX_HISTORY,
      ),
      current: next,
      future: [],
    }));
    if (message) setStatus(message);
  }

  function updateTitle(title: string) {
    setHistory((previous) => ({
      ...previous,
      current: { ...previous.current, title },
    }));
  }

  function updateRow(
    rowId: string,
    updater: (row: PatternRow) => PatternRow,
  ) {
    const next = cloneDocument(document);
    const index = next.rows.findIndex((row) => row.id === rowId);
    const row = next.rows[index];
    if (!row) return;
    next.rows[index] = updater(row);
    commit(next);
    setSelectedRowId(rowId);
  }

  function toggleLane(rowId: string, lane: Lane) {
    updateRow(rowId, (row) => ({
      ...row,
      lanes: { ...row.lanes, [lane]: !row.lanes[lane] },
    }));
  }

  function toggleOpen(rowId: string) {
    updateRow(rowId, (row) => ({
      ...row,
      open: !row.open,
    }));
  }

  function addRows(count: number) {
    if (document.rows.length >= MAX_ROWS) {
      setStatus(`Maximum atteint : ${MAX_ROWS} lignes.`);
      return;
    }
    const allowed = Math.min(count, MAX_ROWS - document.rows.length);
    const additions = Array.from({ length: allowed }, createRow);
    const next = { ...document, rows: [...document.rows, ...additions] };
    commit(next, `${allowed} ligne${allowed > 1 ? "s" : ""} ajoutée${allowed > 1 ? "s" : ""}.`);
    setSelectedRowId(additions[0]?.id ?? selectedRowId);
  }

  function insertRowAfter(rowId: string) {
    if (document.rows.length >= MAX_ROWS) return;
    const index = document.rows.findIndex((row) => row.id === rowId);
    if (index < 0) return;
    const row = createRow();
    const next = cloneDocument(document);
    next.rows.splice(index + 1, 0, row);
    commit(next, "Ligne insérée.");
    setSelectedRowId(row.id);
  }

  function duplicateRow(rowId: string) {
    if (document.rows.length >= MAX_ROWS) return;
    const index = document.rows.findIndex((row) => row.id === rowId);
    const source = document.rows[index];
    if (!source) return;
    const copy = { ...cloneDocument({ version: 1, title: "", rows: [source] }).rows[0]!, id: createId() };
    const next = cloneDocument(document);
    next.rows.splice(index + 1, 0, copy);
    commit(next, "Ligne dupliquée.");
    setSelectedRowId(copy.id);
  }

  function removeRow(rowId: string) {
    if (document.rows.length <= 1) {
      setStatus("Il faut garder au moins une ligne.");
      return;
    }
    const index = document.rows.findIndex((row) => row.id === rowId);
    if (index < 0) return;
    const next = {
      ...document,
      rows: document.rows.filter((row) => row.id !== rowId),
    };
    commit(next, "Ligne supprimée.");
    setSelectedRowId(next.rows[Math.min(index, next.rows.length - 1)]?.id ?? null);
  }

  function trimEmptyRows() {
    let lastUsed = document.rows.length - 1;
    while (lastUsed > 0 && !rowHasNotes(document.rows[lastUsed]!)) {
      lastUsed -= 1;
    }
    const nextRows = document.rows.slice(0, lastUsed + 1);
    if (nextRows.length === document.rows.length) {
      setStatus("Aucune ligne vide à retirer en fin de pattern.");
      return;
    }
    commit({ ...document, rows: nextRows }, "Lignes vides de fin retirées.");
    if (!nextRows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(nextRows.at(-1)?.id ?? null);
    }
  }

  function clearPattern() {
    if (document.rows.some(rowHasNotes) && !window.confirm("Effacer toutes les notes ?")) {
      return;
    }
    const next = {
      ...document,
      rows: document.rows.map(() => createRow()),
    };
    commit(next, "Pattern effacé.");
    setSelectedRowId(next.rows[0]?.id ?? null);
  }

  function loadExample() {
    if (document.rows.some(rowHasNotes) && !window.confirm("Remplacer le pattern actuel par l’exemple ?")) {
      return;
    }
    const next = buildExample();
    commit(next, "Exemple chargé.");
    setSelectedRowId(next.rows[0]?.id ?? null);
  }

  function undo() {
    setHistory((previous) => {
      const previousDocument = previous.past.at(-1);
      if (!previousDocument) return previous;
      return {
        past: previous.past.slice(0, -1),
        current: cloneDocument(previousDocument),
        future: [cloneDocument(previous.current), ...previous.future],
      };
    });
    setStatus("Modification annulée.");
  }

  function redo() {
    setHistory((previous) => {
      const nextDocument = previous.future[0];
      if (!nextDocument) return previous;
      return {
        past: [...previous.past, cloneDocument(previous.current)].slice(
          -MAX_HISTORY,
        ),
        current: cloneDocument(nextDocument),
        future: previous.future.slice(1),
      };
    });
    setStatus("Modification rétablie.");
  }

  async function handleCopy() {
    try {
      await copyText(exportedText);
      setStatus("Pattern copié : tu peux le coller dans Discord.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Impossible de copier le pattern.",
      );
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }

      const currentIndex = document.rows.findIndex(
        (row) => row.id === selectedRowId,
      );
      if (currentIndex < 0 || !selectedRowId) return;

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = Math.max(
          0,
          Math.min(document.rows.length - 1, currentIndex + offset),
        );
        setSelectedRowId(document.rows[nextIndex]?.id ?? null);
        return;
      }

      const lane = LANES[Number(event.key) - 1];
      if (lane) {
        event.preventDefault();
        toggleLane(selectedRowId, lane);
      } else if (event.key === "0") {
        event.preventDefault();
        toggleOpen(selectedRowId);
      } else if (event.key === "Enter") {
        event.preventDefault();
        insertRowAfter(selectedRowId);
      } else if (event.key === "Delete") {
        event.preventDefault();
        removeRow(selectedRowId);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const usedRows = document.rows.filter(rowHasNotes).length;

  if (availableUpdate) {
    const percent =
      updateProgress && updateProgress.total > 0
        ? Math.round((updateProgress.downloaded / updateProgress.total) * 100)
        : null;

    return (
      <div className="update-screen">
        <h1>Mise à jour disponible</h1>
        <p>
          Une nouvelle version de Patternmania est disponible :{" "}
          <strong>{availableUpdate.version}</strong>.
        </p>
        {percent !== null ? (
          <div className="update-screen__progress">
            <div className="update-screen__bar" style={{ width: `${percent}%` }} />
            <span>{percent}%</span>
          </div>
        ) : (
          <button onClick={installUpdate} className="primary">
            Mettre à jour maintenant
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            {LANES.map((lane) => (
              <span key={lane} className={lane} />
            ))}
          </div>
          <div>
            <p className="eyebrow">PATTERNMANIA</p>
            <h1>Explique ton pattern, simplement.</h1>
          </div>
        </div>
      </header>

      <section className="toolbar panel">

        <div className="toolbar-stats">
          <strong>{document.rows.length}</strong>
          <span>lignes</span>
        </div>
        <div className="toolbar-stats">
          <strong>{usedRows}</strong>
          <span>utilisées</span>
        </div>

        <div className="toolbar-actions">
          <button className="secondary" onClick={undo} disabled={!history.past.length}>
            ↶ Annuler
          </button>
          <button className="secondary" onClick={redo} disabled={!history.future.length}>
            ↷ Rétablir
          </button>
          <button className="secondary" onClick={loadExample}>
            Exemple
          </button>
          <button className="danger" onClick={clearPattern}>
            Tout effacer
          </button>
        </div>
      </section>

      <main className="workspace">
        <section className="editor-panel panel">
          <div className="panel-heading editor-heading">
            <div>
              <h2>Piste</h2>
              <p>Une note ouverte occupe toute la ligne et peut être combinée avec les notes colorées.</p>
            </div>
            <div className="editor-actions">
              <button className="secondary compact-button" onClick={() => addRows(1)}>
                + 1 ligne
              </button>
              <button className="secondary compact-button" onClick={() => addRows(4)}>
                + 4 lignes
              </button>
              <button className="ghost-button" onClick={trimEmptyRows}>
                Retirer la fin vide
              </button>
            </div>
          </div>

          <div className="track-shell">
            <div className="track-header track-row">
              <div className="row-number">#</div>
              <div className="lane-header open" title="Note ouverte">OU</div>
              {LANES.map((lane) => (
                <div
                  key={lane}
                  className={`lane-header ${lane}`}
                  title={`${LANE_META[lane].label} — touche ${LANE_META[lane].key}`}
                >
                  <span className="header-note" />
                  <b>{LANE_META[lane].short}</b>
                </div>
              ))}
              <div className="row-tools-header">Actions</div>
            </div>

            <div className="track-scroll">
              {document.rows.map((row, index) => {
                const selected = row.id === selectedRowId;
                return (
                  <div
                    className={`track-row pattern-row ${selected ? "selected" : ""}`}
                    key={row.id}
                    onClick={() => setSelectedRowId(row.id)}
                  >
                    <button
                      className="row-number row-selector"
                      onClick={() => setSelectedRowId(row.id)}
                      aria-label={`Sélectionner la ligne ${index + 1}`}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </button>

                    <div className="note-cell open-cell">
                      <button
                        className={`open-note ${row.open ? "active" : ""}`}
                        onClick={() => toggleOpen(row.id)}
                        title="Note ouverte — touche 0"
                        aria-label={`Note ouverte, ligne ${index + 1}`}
                      >
                        <span />
                      </button>
                    </div>

                    {LANES.map((lane) => (
                      <div className="note-cell" key={lane}>
                        <button
                          className={`note-button ${lane} ${row.lanes[lane] ? "active" : ""}`}
                          onClick={() => toggleLane(row.id, lane)}
                          title={`${LANE_META[lane].label} — touche ${LANE_META[lane].key}`}
                          aria-label={`${LANE_META[lane].label}, ligne ${index + 1}`}
                        />
                      </div>
                    ))}

                    <div className="row-tools">
                      <button
                        className="icon-button"
                        onClick={() => insertRowAfter(row.id)}
                        title="Insérer une ligne après"
                        aria-label="Insérer une ligne après"
                      >
                        ＋
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => duplicateRow(row.id)}
                        title="Dupliquer cette ligne"
                        aria-label="Dupliquer cette ligne"
                      >
                        ⧉
                      </button>
                      <button
                        className="icon-button delete"
                        onClick={() => removeRow(row.id)}
                        title="Supprimer cette ligne"
                        aria-label="Supprimer cette ligne"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="export-panel panel">
          <div className="panel-heading export-heading">
            <div>
              <h2>Rendu Discord</h2>
              <p>Mis à jour instantanément.</p>
            </div>
            <button
              className="primary header-copy-button"
              onClick={handleCopy}
            >
              Copier
            </button>
          </div>

          <label className="field">
            <span>Style d’export</span>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
            >
              <option value="visual">Piste visuelle</option>
              <option value="compact">Liste compacte</option>
            </select>
          </label>

          <div className="export-options">
            <label className="switch-row">
              <span>
                <strong>Garder les silences</strong>
                <small>Conserve les lignes vides du pattern.</small>
              </span>
              <input
                type="checkbox"
                checked={keepSilences}
                onChange={(event) => setKeepSilences(event.target.checked)}
              />
            </label>

            {format === "visual" && (
              <>
                <label className="switch-row">
                  <span>
                    <strong>Numéroter les lignes</strong>
                    <small>Affiche 01, 02, 03…</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={showNumbers}
                    onChange={(event) => setShowNumbers(event.target.checked)}
                  />
                </label>

                <label className="switch-row">
                  <span>
                    <strong>Afficher les points vides</strong>
                    <small>Remplace les emplacements vides par des espaces.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={showEmptyDots}
                    onChange={(event) => setShowEmptyDots(event.target.checked)}
                  />
                </label>
              </>
            )}

            <label className="switch-row">
              <span>
                <strong>Bloc Discord</strong>
                <small>Préserve la forme et les espacements du pattern.</small>
              </span>
              <input
                type="checkbox"
                checked={wrapCodeBlock}
                onChange={(event) => setWrapCodeBlock(event.target.checked)}
              />
            </label>
          </div>

          <pre
            className="export-preview discord-preview"
            aria-label="Aperçu Discord"
          >
            {exportedBody}
          </pre>
        </aside>
      </main>

      <footer className="status-bar">
        <span>{status}</span>
        <span>Sauvegarde automatique locale</span>
      </footer>
    </div>
  );
}

export default App;