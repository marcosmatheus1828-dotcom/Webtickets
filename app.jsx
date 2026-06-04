import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const SHIFT_START = 7 * 60;   // 7:00 in minutes
const SHIFT_END   = 17 * 60;  // 17:00 in minutes
const GUICHES     = [1, 2, 3];
const TM = { SP: 15, SG: 5, SE: 1 };
const PANEL_SIZE  = 5;
const SKIP_RATE   = 0.05;   // 5% não atendidas
const SE_LONG_RATE = 0.05;  // 5% SE demoram 5 min

function randomTM(type) {
  if (type === "SP") {
    const v = Math.random() < 0.5 ? -5 : 5;
    return Math.max(1, TM.SP + v);
  }
  if (type === "SG") {
    const v = (Math.random() * 6) - 3;
    return Math.max(1, TM.SG + v);
  }
  if (type === "SE") {
    return Math.random() < SE_LONG_RATE ? 5 : 1;
  }
  return 1;
}

function formatMinutes(m) {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const min = Math.floor(m % 60).toString().padStart(2, "0");
  return `${h}:${min}`;
}

function buildTicketId(type, seq, clockMin) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const pp = type;
  const sq = String(seq).padStart(3, "0");
  return `${yy}${mm}${dd}-${pp}${sq}`;
}

// ─── INITIAL STATE ────────────────────────────────────────────────────────────
const makeInitialState = () => ({
  clock: SHIFT_START,          // minutos desde meia-noite
  running: false,
  speed: 1,                    // multiplicador de velocidade
  queues: { SP: [], SG: [], SE: [] },
  guiches: GUICHES.map(id => ({ id, busy: false, freeAt: SHIFT_START, currentTicket: null })),
  panel: [],                   // últimas 5 senhas chamadas
  allTickets: [],              // histórico completo
  seqCounters: { SP: 0, SG: 0, SE: 0 },
  lastCalledType: null,        // controla alternância SP → SE|SG → SP...
  log: [],
  view: "totem",               // totem | panel | guiche | reports
  reportType: "daily",
});

// ─── QUEUE LOGIC ──────────────────────────────────────────────────────────────
function getNextType(lastCalled, queues) {
  const hasSP = queues.SP.length > 0;
  const hasSE = queues.SE.length > 0;
  const hasSG = queues.SG.length > 0;

  if (!hasSP && !hasSE && !hasSG) return null;

  // Regra: [SP] → [SE|SG] → [SP] → ...
  if (!lastCalled || lastCalled === "SG" || lastCalled === "SE") {
    if (hasSP) return "SP";
    if (hasSE) return "SE";
    if (hasSG) return "SG";
  } else {
    // lastCalled === SP → chamar SE ou SG
    if (hasSE) return "SE";
    if (hasSG) return "SG";
    if (hasSP) return "SP"; // only SP left
  }
  return null;
}

// ─── REDUCER ──────────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {

    case "SET_VIEW": return { ...state, view: action.payload };
    case "SET_SPEED": return { ...state, speed: action.payload };
    case "SET_REPORT_TYPE": return { ...state, reportType: action.payload };

    case "TOGGLE_RUN":
      if (state.clock >= SHIFT_END) return state;
      return { ...state, running: !state.running };

    case "RESET":
      return { ...makeInitialState(), view: state.view };

    case "EMIT_TICKET": {
      const type = action.payload;
      if (state.clock < SHIFT_START || state.clock >= SHIFT_END) return state;
      const newSeq = state.seqCounters[type] + 1;
      const id = buildTicketId(type, newSeq, state.clock);
      const skipped = Math.random() < SKIP_RATE;
      const ticket = {
        id, type, seq: newSeq,
        emittedAt: state.clock,
        calledAt: null, servedAt: null,
        guiche: null, skipped,
        tm: null,
      };
      return {
        ...state,
        seqCounters: { ...state.seqCounters, [type]: newSeq },
        queues: { ...state.queues, [type]: [...state.queues[type], ticket] },
        allTickets: [...state.allTickets, ticket],
        log: [...state.log, `${formatMinutes(state.clock)} › Senha emitida: ${id}${skipped ? " (será descartada)" : ""}`].slice(-50),
      };
    }

    case "TICK": {
      if (!state.running || state.clock >= SHIFT_END) {
        return { ...state, running: false };
      }
      const next = state.clock + (1 / 60) * state.speed; // 1s real = speed min

      // update guiches: free finished ones
      let guiches = state.guiches.map(g => {
        if (g.busy && next >= g.freeAt) {
          return { ...g, busy: false, currentTicket: null };
        }
        return g;
      });

      let queues = { ...state.queues, SP: [...state.queues.SP], SG: [...state.queues.SG], SE: [...state.queues.SE] };
      let panel = [...state.panel];
      let allTickets = [...state.allTickets];
      let lastCalledType = state.lastCalledType;
      let log = [...state.log];

      // Try to assign tickets to free guiches
      const freeGuiches = guiches.filter(g => !g.busy && next >= g.freeAt);
      for (const fg of freeGuiches) {
        const type = getNextType(lastCalledType, queues);
        if (!type) break;

        const ticket = queues[type].shift();
        if (!ticket) break;

        const tm = randomTM(type);
        const freeAt = next + tm;

        const updatedTicket = {
          ...ticket,
          calledAt: next,
          servedAt: ticket.skipped ? null : freeAt,
          guiche: ticket.skipped ? null : fg.id,
          tm,
        };

        // Update allTickets
        allTickets = allTickets.map(t => t.id === ticket.id ? updatedTicket : t);

        if (!ticket.skipped) {
          guiches = guiches.map(g =>
            g.id === fg.id ? { ...g, busy: true, freeAt, currentTicket: updatedTicket } : g
          );
          panel = [updatedTicket, ...panel].slice(0, PANEL_SIZE);
          lastCalledType = type;
          log = [...log, `${formatMinutes(next)} › ${ticket.id} → Guichê ${fg.id} (TM: ${tm.toFixed(1)}min)`].slice(-50);
        } else {
          log = [...log, `${formatMinutes(next)} › ${ticket.id} descartada (AC ausente)`].slice(-50);
        }
      }

      return {
        ...state,
        clock: next,
        guiches,
        queues,
        panel,
        allTickets,
        lastCalledType,
        log,
        running: next < SHIFT_END,
      };
    }

    default: return state;
  }
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0c10;
    --surface: #111318;
    --surface2: #181c24;
    --border: #ffffff12;
    --accent-blue: #3b82f6;
    --accent-cyan: #06b6d4;
    --accent-amber: #f59e0b;
    --accent-red: #ef4444;
    --accent-green: #22c55e;
    --accent-purple: #a855f7;
    --text: #e8eaf0;
    --muted: #6b7280;
    --sp: #ef4444;
    --sg: #3b82f6;
    --se: #22c55e;
    --font-head: 'Syne', sans-serif;
    --font-mono: 'DM Mono', monospace;
  }

  body { background: var(--bg); color: var(--text); font-family: var(--font-head); }

  .app {
    min-height: 100vh;
    display: grid;
    grid-template-rows: 56px 1fr;
  }

  /* NAV */
  nav {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 24px;
    gap: 8px;
    position: sticky; top: 0; z-index: 100;
  }
  .nav-brand {
    font-size: 13px; font-weight: 800; letter-spacing: 0.15em;
    text-transform: uppercase; color: var(--accent-cyan);
    margin-right: 24px; white-space: nowrap;
  }
  .nav-btn {
    padding: 6px 16px; border-radius: 6px; border: 1px solid var(--border);
    background: transparent; color: var(--muted); font-family: var(--font-head);
    font-size: 12px; font-weight: 600; letter-spacing: 0.05em;
    cursor: pointer; transition: all 0.15s;
  }
  .nav-btn:hover { color: var(--text); border-color: #ffffff30; }
  .nav-btn.active { background: var(--accent-blue); color: #fff; border-color: var(--accent-blue); }
  .nav-spacer { flex: 1; }
  .clock-display {
    font-family: var(--font-mono); font-size: 22px; font-weight: 500;
    color: var(--accent-cyan); letter-spacing: 0.05em;
    padding: 4px 16px; background: var(--surface2); border-radius: 8px;
    border: 1px solid var(--border);
  }
  .clock-display.shift-ended { color: var(--accent-red); }
  .ctrl-btn {
    padding: 8px 20px; border-radius: 8px; border: none;
    font-family: var(--font-head); font-size: 13px; font-weight: 700;
    cursor: pointer; transition: all 0.15s; letter-spacing: 0.05em;
  }
  .ctrl-btn.run { background: var(--accent-green); color: #000; }
  .ctrl-btn.pause { background: var(--accent-amber); color: #000; }
  .ctrl-btn.reset { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); }
  .ctrl-btn:hover { filter: brightness(1.1); }
  .speed-sel {
    background: var(--surface2); border: 1px solid var(--border);
    color: var(--text); border-radius: 6px; padding: 6px 10px;
    font-family: var(--font-mono); font-size: 12px; cursor: pointer;
  }

  main { padding: 24px; max-width: 1400px; margin: 0 auto; width: 100%; }

  /* TOTEM */
  .totem-wrap {
    display: grid; grid-template-columns: 360px 1fr; gap: 24px;
  }
  .totem-card {
    background: linear-gradient(160deg, #13171f, #0d1117);
    border: 1px solid var(--border); border-radius: 20px;
    padding: 32px; display: flex; flex-direction: column; gap: 20px;
    position: relative; overflow: hidden;
  }
  .totem-card::before {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% 0%, #3b82f615 0%, transparent 70%);
    pointer-events: none;
  }
  .totem-title {
    font-size: 11px; font-weight: 700; letter-spacing: 0.2em;
    text-transform: uppercase; color: var(--muted);
  }
  .totem-heading {
    font-size: 26px; font-weight: 800; line-height: 1.2;
    color: var(--text);
  }
  .ticket-btn {
    padding: 18px; border-radius: 14px; border: none; cursor: pointer;
    font-family: var(--font-head); font-weight: 800; font-size: 15px;
    letter-spacing: 0.05em; transition: all 0.2s;
    display: flex; align-items: center; gap: 12px;
    position: relative; overflow: hidden;
  }
  .ticket-btn::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(135deg, #ffffff15, transparent);
  }
  .ticket-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 24px #0006; }
  .ticket-btn:active { transform: translateY(0); }
  .ticket-btn.sp { background: linear-gradient(135deg, #b91c1c, #ef4444); color: #fff; }
  .ticket-btn.sg { background: linear-gradient(135deg, #1d4ed8, #3b82f6); color: #fff; }
  .ticket-btn.se { background: linear-gradient(135deg, #15803d, #22c55e); color: #fff; }
  .ticket-btn-icon { font-size: 24px; }
  .ticket-btn-body { text-align: left; }
  .ticket-btn-label { font-size: 18px; }
  .ticket-btn-desc { font-size: 11px; font-weight: 400; opacity: 0.8; margin-top: 2px; }

  .last-emitted {
    background: var(--surface2); border: 1px solid var(--border); border-radius: 12px;
    padding: 16px; font-family: var(--font-mono); font-size: 13px; color: var(--muted);
  }
  .last-emitted strong { color: var(--text); font-size: 18px; display: block; margin-top: 4px; }

  /* RIGHT SIDE */
  .side-grid { display: flex; flex-direction: column; gap: 20px; }
  .queues-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .queue-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
    padding: 20px; position: relative; overflow: hidden;
  }
  .queue-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  }
  .queue-card.sp::before { background: var(--sp); }
  .queue-card.sg::before { background: var(--sg); }
  .queue-card.se::before { background: var(--se); }
  .q-label { font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; }
  .q-label.sp { color: var(--sp); }
  .q-label.sg { color: var(--sg); }
  .q-label.se { color: var(--se); }
  .q-count { font-size: 48px; font-weight: 800; line-height: 1; margin: 8px 0 4px; }
  .q-sub { font-size: 12px; color: var(--muted); font-family: var(--font-mono); }

  .guiches-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .guiche-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
    padding: 20px; transition: border-color 0.3s;
  }
  .guiche-card.busy { border-color: var(--accent-cyan); }
  .guiche-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .guiche-name { font-size: 13px; font-weight: 700; letter-spacing: 0.1em; }
  .guiche-badge {
    font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 20px;
    letter-spacing: 0.05em; text-transform: uppercase;
  }
  .guiche-badge.free { background: #22c55e20; color: var(--accent-green); }
  .guiche-badge.busy { background: #06b6d420; color: var(--accent-cyan); }
  .guiche-ticket { font-family: var(--font-mono); font-size: 16px; color: var(--text); font-weight: 500; }
  .guiche-ticket-type { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .guiche-free-at { font-size: 11px; color: var(--muted); font-family: var(--font-mono); margin-top: 8px; }

  /* LOG */
  .log-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
    padding: 20px; flex: 1;
  }
  .log-title { font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px; }
  .log-scroll { height: 180px; overflow-y: auto; display: flex; flex-direction: column-reverse; gap: 4px; }
  .log-entry { font-family: var(--font-mono); font-size: 11px; color: var(--muted); padding: 3px 0; border-bottom: 1px solid var(--border); }
  .log-entry:last-child { color: var(--text); }

  /* PANEL VIEW */
  .panel-view {
    background: #05070a;
    min-height: calc(100vh - 80px);
    border-radius: 20px;
    border: 2px solid #ffffff08;
    padding: 40px;
    display: flex; flex-direction: column; gap: 32px;
    position: relative; overflow: hidden;
  }
  .panel-view::before {
    content: ''; position: absolute; inset: 0;
    background:
      radial-gradient(ellipse at 20% 50%, #3b82f608 0%, transparent 60%),
      radial-gradient(ellipse at 80% 20%, #06b6d408 0%, transparent 60%);
    pointer-events: none;
  }
  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
  }
  .panel-brand { font-size: 13px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; color: var(--muted); }
  .panel-clock { font-family: var(--font-mono); font-size: 48px; font-weight: 300; color: var(--accent-cyan); letter-spacing: 0.05em; }
  .panel-guiches { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .panel-guiche {
    border: 1px solid var(--border); border-radius: 16px; padding: 24px;
    background: var(--surface);
    transition: all 0.3s;
  }
  .panel-guiche.active {
    border-color: var(--accent-cyan);
    background: linear-gradient(160deg, #06b6d408, var(--surface));
    box-shadow: 0 0 40px #06b6d415;
  }
  .pg-num { font-size: 11px; font-weight: 700; letter-spacing: 0.2em; color: var(--muted); text-transform: uppercase; }
  .pg-ticket {
    font-family: var(--font-mono); font-size: 32px; font-weight: 500;
    color: var(--text); margin-top: 8px; min-height: 44px;
  }
  .pg-ticket.empty { color: var(--muted); font-size: 20px; }
  .pg-type { margin-top: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; }
  .pg-type.sp { color: var(--sp); }
  .pg-type.sg { color: var(--sg); }
  .pg-type.se { color: var(--se); }

  .panel-history { }
  .ph-title { font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 16px; }
  .ph-list { display: flex; flex-direction: column; gap: 8px; }
  .ph-item {
    display: flex; align-items: center; gap: 16px;
    padding: 14px 20px; background: var(--surface); border-radius: 12px;
    border: 1px solid var(--border); transition: all 0.3s;
  }
  .ph-item:first-child { border-color: #ffffff20; }
  .ph-badge {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  }
  .ph-badge.sp { background: var(--sp); }
  .ph-badge.sg { background: var(--sg); }
  .ph-badge.se { background: var(--se); }
  .ph-id { font-family: var(--font-mono); font-size: 20px; color: var(--text); flex: 1; }
  .ph-guiche { font-size: 12px; color: var(--muted); }
  .ph-time { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }

  /* REPORTS */
  .reports-wrap { display: flex; flex-direction: column; gap: 20px; }
  .rep-tabs { display: flex; gap: 8px; }
  .rep-tab {
    padding: 8px 20px; border-radius: 8px; border: 1px solid var(--border);
    background: transparent; color: var(--muted); font-family: var(--font-head);
    font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.15s;
    letter-spacing: 0.05em;
  }
  .rep-tab.active { background: var(--accent-blue); color: #fff; border-color: var(--accent-blue); }

  .rep-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
    padding: 20px;
  }
  .stat-label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  .stat-value { font-size: 40px; font-weight: 800; line-height: 1; margin-top: 8px; }
  .stat-value.blue { color: var(--accent-blue); }
  .stat-value.green { color: var(--accent-green); }
  .stat-value.red { color: var(--accent-red); }
  .stat-value.amber { color: var(--accent-amber); }

  .rep-by-type { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .type-card {
    background: var(--surface); border-radius: 14px; padding: 20px; border: 1px solid var(--border);
    position: relative; overflow: hidden;
  }
  .type-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
  .type-card.sp::before { background: var(--sp); }
  .type-card.sg::before { background: var(--sg); }
  .type-card.se::before { background: var(--se); }
  .type-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  .type-row:last-child { border-bottom: none; }
  .type-row-val { font-family: var(--font-mono); font-weight: 500; }

  .rep-table-wrap {
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
    overflow: hidden;
  }
  .rep-table-header {
    padding: 16px 20px; border-bottom: 1px solid var(--border);
    font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted);
  }
  .rep-table { width: 100%; border-collapse: collapse; }
  .rep-table th {
    padding: 12px 16px; text-align: left; font-size: 10px; font-weight: 700;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .rep-table td {
    padding: 10px 16px; font-family: var(--font-mono); font-size: 12px;
    border-bottom: 1px solid var(--border);
  }
  .rep-table tr:last-child td { border-bottom: none; }
  .rep-table tr:hover td { background: var(--surface2); }
  .badge-type {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
  }
  .badge-type.sp { background: #ef444420; color: var(--sp); }
  .badge-type.sg { background: #3b82f620; color: var(--sg); }
  .badge-type.se { background: #22c55e20; color: var(--se); }
  .badge-skipped { background: #6b728020; color: var(--muted); display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; }

  /* scrollbar */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

  @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
  .fade-in { animation: fadeIn 0.3s ease both; }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
  .pulse { animation: pulse 1.5s ease-in-out infinite; }
`;

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function App() {
  const [state, dispatch] = useState(makeInitialState);
  const tickRef = useRef(null);
  const [lastEmitted, setLastEmitted] = useState(null);

  // Injetar CSS
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  // Tick loop
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (state.running) {
      tickRef.current = setInterval(() => {
        dispatch(s => reducer(s, { type: "TICK" }));
      }, 1000);
    }
    return () => clearInterval(tickRef.current);
  }, [state.running, state.speed]);

  const emit = useCallback((type) => {
    dispatch(s => {
      const next = reducer(s, { type: "EMIT_TICKET", payload: type });
      setLastEmitted(next.allTickets[next.allTickets.length - 1]);
      return next;
    });
  }, []);

  const isShiftEnded = state.clock >= SHIFT_END;
  const shiftProgress = Math.min(100, ((state.clock - SHIFT_START) / (SHIFT_END - SHIFT_START)) * 100);

  // ── Computed stats ──
  const stats = (() => {
    const all = state.allTickets;
    const attended = all.filter(t => !t.skipped && t.calledAt !== null);
    const skipped = all.filter(t => t.skipped);
    const tmByType = {};
    ["SP","SG","SE"].forEach(tp => {
      const tms = attended.filter(t=>t.type===tp&&t.tm).map(t=>t.tm);
      tmByType[tp] = tms.length ? (tms.reduce((a,b)=>a+b,0)/tms.length).toFixed(1) : "–";
    });
    return { all, attended, skipped, tmByType };
  })();

  // ── Views ──
  const renderTotem = () => (
    <div className="totem-wrap fade-in">
      {/* LEFT: Totem */}
      <div className="totem-card">
        <div>
          <div className="totem-title">Laboratório Médico</div>
          <div className="totem-heading">Retire sua<br/>senha de<br/>atendimento</div>
        </div>

        <button className="ticket-btn sp" onClick={()=>emit("SP")} disabled={isShiftEnded}>
          <span className="ticket-btn-icon">🔴</span>
          <div className="ticket-btn-body">
            <div className="ticket-btn-label">SP — Prioritária</div>
            <div className="ticket-btn-desc">Idosos, gestantes, PCDs</div>
          </div>
        </button>

        <button className="ticket-btn sg" onClick={()=>emit("SG")} disabled={isShiftEnded}>
          <span className="ticket-btn-icon">🔵</span>
          <div className="ticket-btn-body">
            <div className="ticket-btn-label">SG — Geral</div>
            <div className="ticket-btn-desc">Atendimento regular</div>
          </div>
        </button>

        <button className="ticket-btn se" onClick={()=>emit("SE")} disabled={isShiftEnded}>
          <span className="ticket-btn-icon">🟢</span>
          <div className="ticket-btn-body">
            <div className="ticket-btn-label">SE — Exames</div>
            <div className="ticket-btn-desc">Retirada de resultados</div>
          </div>
        </button>

        {lastEmitted && (
          <div className="last-emitted">
            Última senha emitida:
            <strong>{lastEmitted.id}</strong>
            {lastEmitted.skipped && <span style={{color:"var(--accent-amber)",fontSize:11}}> ⚠ Pode ser descartada</span>}
          </div>
        )}

        {isShiftEnded && (
          <div style={{background:"#ef444420",border:"1px solid var(--sp)",borderRadius:10,padding:14,textAlign:"center",color:"var(--sp)",fontSize:13,fontWeight:700}}>
            ⚠ Expediente encerrado às 17:00
          </div>
        )}
      </div>

      {/* RIGHT */}
      <div className="side-grid">
        {/* Filas */}
        <div className="queues-row">
          {["SP","SG","SE"].map(tp => (
            <div key={tp} className={`queue-card ${tp.toLowerCase()}`}>
              <div className={`q-label ${tp.toLowerCase()}`}>{tp === "SP" ? "Prioritária" : tp === "SG" ? "Geral" : "Exames"}</div>
              <div className="q-count">{state.queues[tp].length}</div>
              <div className="q-sub">na fila • TM base: {TM[tp]}min</div>
            </div>
          ))}
        </div>

        {/* Guichês */}
        <div className="guiches-row">
          {state.guiches.map(g => (
            <div key={g.id} className={`guiche-card ${g.busy?"busy":""}`}>
              <div className="guiche-header">
                <div className="guiche-name">GUICHÊ {g.id}</div>
                <div className={`guiche-badge ${g.busy?"busy":"free"}`}>{g.busy?"Em atendimento":"Livre"}</div>
              </div>
              {g.currentTicket ? (
                <>
                  <div className="guiche-ticket">{g.currentTicket.id}</div>
                  <div className={`guiche-ticket-type ${g.currentTicket.type.toLowerCase()}`} style={{color:`var(--${g.currentTicket.type.toLowerCase()})`}}>
                    {g.currentTicket.type === "SP" ? "Prioritária" : g.currentTicket.type === "SG" ? "Geral" : "Exames"}
                  </div>
                  <div className="guiche-free-at">Livre às {formatMinutes(g.freeAt)}</div>
                </>
              ) : (
                <div className="guiche-ticket empty">— aguardando —</div>
              )}
            </div>
          ))}
        </div>

        {/* Log */}
        <div className="log-card">
          <div className="log-title">Log de eventos</div>
          <div className="log-scroll">
            {[...state.log].reverse().map((l,i) => (
              <div key={i} className="log-entry">{l}</div>
            ))}
            {state.log.length === 0 && <div className="log-entry" style={{fontStyle:"italic"}}>Nenhum evento ainda...</div>}
          </div>
        </div>
      </div>
    </div>
  );

  const renderPanel = () => (
    <div className="panel-view fade-in">
      <div className="panel-header">
        <div>
          <div className="panel-brand">Laboratório Médico — Painel de Chamados</div>
        </div>
        <div className={`panel-clock ${isShiftEnded?"shift-ended":""}`}>{formatMinutes(state.clock)}</div>
      </div>

      <div>
        <div className="ph-title" style={{marginBottom:16}}>Guichês</div>
        <div className="panel-guiches">
          {state.guiches.map(g => (
            <div key={g.id} className={`panel-guiche ${g.busy?"active":""}`}>
              <div className="pg-num">Guichê {g.id}</div>
              {g.currentTicket ? (
                <>
                  <div className="pg-ticket">{g.currentTicket.id}</div>
                  <div className={`pg-type ${g.currentTicket.type.toLowerCase()}`}>{g.currentTicket.type} — {g.currentTicket.type==="SP"?"Prioritária":g.currentTicket.type==="SG"?"Geral":"Exames"}</div>
                </>
              ) : (
                <div className="pg-ticket empty">LIVRE</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="panel-history">
        <div className="ph-title">Últimas {PANEL_SIZE} senhas chamadas</div>
        <div className="ph-list">
          {state.panel.length === 0 && (
            <div className="ph-item"><span style={{color:"var(--muted)",fontFamily:"var(--font-mono)",fontSize:14}}>Nenhuma senha chamada ainda</span></div>
          )}
          {state.panel.map((t,i) => (
            <div key={t.id} className="ph-item">
              <div className={`ph-badge ${t.type.toLowerCase()}`}/>
              <div className="ph-id">{t.id}</div>
              <div className="ph-guiche">Guichê {t.guiche}</div>
              <div className="ph-time">{formatMinutes(t.calledAt)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{marginTop:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--muted)",marginBottom:6,fontFamily:"var(--font-mono)"}}>
          <span>07:00</span>
          <span style={{color:isShiftEnded?"var(--accent-red)":"var(--muted)"}}>
            {isShiftEnded ? "EXPEDIENTE ENCERRADO" : `${(100-shiftProgress).toFixed(0)}% restante`}
          </span>
          <span>17:00</span>
        </div>
        <div style={{height:4,background:"var(--surface)",borderRadius:2,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${shiftProgress}%`,background:isShiftEnded?"var(--accent-red)":"var(--accent-cyan)",transition:"width 0.5s",borderRadius:2}}/>
        </div>
      </div>
    </div>
  );

  const renderReports = () => {
    const { all, attended, skipped, tmByType } = stats;
    const byType = tp => ({
      emitted: all.filter(t=>t.type===tp).length,
      attended: attended.filter(t=>t.type===tp).length,
      skipped: skipped.filter(t=>t.type===tp).length,
    });
    const spS = byType("SP"), sgS = byType("SG"), seS = byType("SE");

    return (
      <div className="reports-wrap fade-in">
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div className="rep-tabs">
            <button className={`rep-tab ${state.reportType==="daily"?"active":""}`} onClick={()=>dispatch(s=>({...s,reportType:"daily"}))}>Relatório Diário</button>
            <button className={`rep-tab ${state.reportType==="detail"?"active":""}`} onClick={()=>dispatch(s=>({...s,reportType:"detail"}))}>Detalhado</button>
            <button className={`rep-tab ${state.reportType==="tm"?"active":""}`} onClick={()=>dispatch(s=>({...s,reportType:"tm"}))}>TM Real</button>
          </div>
        </div>

        {state.reportType === "daily" && (
          <>
            <div className="rep-summary">
              <div className="stat-card">
                <div className="stat-label">Total Emitidas</div>
                <div className="stat-value blue">{all.length}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total Atendidas</div>
                <div className="stat-value green">{attended.length}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Descartadas</div>
                <div className="stat-value red">{skipped.length}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Taxa Atend.</div>
                <div className="stat-value amber">{all.length?((attended.length/all.length)*100).toFixed(0):0}%</div>
              </div>
            </div>
            <div className="rep-by-type">
              {[["SP","Prioritária"],["SG","Geral"],["SE","Exames"]].map(([tp,label]) => {
                const s = byType(tp);
                return (
                  <div key={tp} className={`type-card ${tp.toLowerCase()}`}>
                    <div style={{marginBottom:16}}>
                      <span className={`q-label ${tp.toLowerCase()}`}>{tp}</span>
                      <span style={{fontSize:12,color:"var(--muted)",marginLeft:8}}>{label}</span>
                    </div>
                    <div className="type-row"><span>Emitidas</span><span className="type-row-val">{s.emitted}</span></div>
                    <div className="type-row"><span>Atendidas</span><span className="type-row-val" style={{color:"var(--accent-green)"}}>{s.attended}</span></div>
                    <div className="type-row"><span>Descartadas</span><span className="type-row-val" style={{color:"var(--accent-red)"}}>{s.skipped}</span></div>
                    <div className="type-row"><span>TM Registrado</span><span className="type-row-val">{tmByType[tp]}min</span></div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {state.reportType === "detail" && (
          <div className="rep-table-wrap">
            <div className="rep-table-header">Registro completo de senhas ({all.length})</div>
            <div style={{overflowX:"auto",maxHeight:500,overflowY:"auto"}}>
              <table className="rep-table">
                <thead>
                  <tr>
                    <th>Senha</th><th>Tipo</th><th>Emissão</th><th>Chamada</th><th>Guichê</th><th>Status</th><th>TM Real</th>
                  </tr>
                </thead>
                <tbody>
                  {all.map(t => (
                    <tr key={t.id}>
                      <td>{t.id}</td>
                      <td><span className={`badge-type ${t.type.toLowerCase()}`}>{t.type}</span></td>
                      <td>{formatMinutes(t.emittedAt)}</td>
                      <td>{t.calledAt ? formatMinutes(t.calledAt) : "–"}</td>
                      <td>{t.guiche ?? "–"}</td>
                      <td>
                        {t.skipped
                          ? <span className="badge-skipped">Descartada</span>
                          : t.calledAt
                            ? <span style={{color:"var(--accent-green)",fontSize:10,fontWeight:700}}>✓ Atendida</span>
                            : <span style={{color:"var(--accent-amber)",fontSize:10,fontWeight:700}}>⏳ Aguardando</span>
                        }
                      </td>
                      <td>{t.tm ? `${t.tm.toFixed(1)}min` : "–"}</td>
                    </tr>
                  ))}
                  {all.length === 0 && (
                    <tr><td colSpan={7} style={{color:"var(--muted)",textAlign:"center",padding:32}}>Nenhuma senha emitida</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {state.reportType === "tm" && (
          <div className="rep-by-type">
            {[["SP","Prioritária",15],["SG","Geral",5],["SE","Exames",1]].map(([tp,label,base]) => {
              const tms = attended.filter(t=>t.type===tp&&t.tm).map(t=>t.tm);
              const avg = tms.length ? tms.reduce((a,b)=>a+b,0)/tms.length : null;
              const min = tms.length ? Math.min(...tms) : null;
              const max = tms.length ? Math.max(...tms) : null;
              return (
                <div key={tp} className={`type-card ${tp.toLowerCase()}`}>
                  <div style={{marginBottom:16}}>
                    <span className={`q-label ${tp.toLowerCase()}`}>{tp} — {label}</span>
                  </div>
                  <div className="type-row"><span>TM Base</span><span className="type-row-val">{base}min</span></div>
                  <div className="type-row"><span>TM Médio Real</span><span className="type-row-val" style={{color:"var(--accent-cyan)"}}>{avg!==null?avg.toFixed(2)+"min":"–"}</span></div>
                  <div className="type-row"><span>Mínimo</span><span className="type-row-val">{min!==null?min.toFixed(2)+"min":"–"}</span></div>
                  <div className="type-row"><span>Máximo</span><span className="type-row-val">{max!==null?max.toFixed(2)+"min":"–"}</span></div>
                  <div className="type-row"><span>Amostras</span><span className="type-row-val">{tms.length}</span></div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app">
      <nav>
        <div className="nav-brand">LabQueue</div>
        {["totem","panel","reports"].map(v => (
          <button key={v} className={`nav-btn ${state.view===v?"active":""}`} onClick={()=>dispatch(s=>({...s,view:v}))}>
            {v==="totem"?"🖥 Totem":v==="panel"?"📺 Painel":"📊 Relatórios"}
          </button>
        ))}
        <div className="nav-spacer"/>
        <select className="speed-sel" value={state.speed} onChange={e=>dispatch(s=>({...s,speed:+e.target.value}))}>
          <option value={1}>1× vel.</option>
          <option value={5}>5×</option>
          <option value={15}>15×</option>
          <option value={60}>60×</option>
        </select>
        <div className={`clock-display ${isShiftEnded?"shift-ended":""}`}>{formatMinutes(state.clock)}</div>
        <button
          className={`ctrl-btn ${state.running?"pause":"run"}`}
          onClick={()=>dispatch(s=>reducer(s,{type:"TOGGLE_RUN"}))}
          disabled={isShiftEnded}
        >
          {state.running ? "⏸ Pausar" : isShiftEnded ? "Encerrado" : "▶ Iniciar"}
        </button>
        <button className="ctrl-btn reset" onClick={()=>dispatch(s=>reducer(s,{type:"RESET"}))}>↺ Reset</button>
      </nav>

      <main>
        {state.view === "totem" && renderTotem()}
        {state.view === "panel" && renderPanel()}
        {state.view === "reports" && renderReports()}
      </main>
    </div>
  );
}