import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const SHIFT_START = 7 * 60;
const SHIFT_END = 17 * 60;
const GUICHES = [1, 2, 3];

const TM = { SP: 15, SG: 5, SE: 1 };
const PANEL_SIZE = 5;

function formatMinutes(m: number) {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const min = Math.floor(m % 60).toString().padStart(2, "0");
  return `${h}:${min}`;
}

function buildTicketId(type: string, seq: number) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}-${type}${String(seq).padStart(3, "0")}`;
}

function randomTM(type: string) {
  if (type === "SP") return 15 + (Math.random() < 0.5 ? -5 : 5);
  if (type === "SG") return 5 + (Math.random() * 6 - 3);
  if (type === "SE") return Math.random() < 0.05 ? 5 : 1;
  return 1;
}

export interface Ticket {
  id: string;
  type: 'SP' | 'SG' | 'SE';
  seq: number;
  emittedAt: number;
  calledAt?: number | null;
  guiche?: number | null;
  tm?: number | null;
  skipped?: boolean;
}

export interface AppState {
  clock: number;
  running: boolean;
  speed: number;

  queues: Record<string, Ticket[]>;
  guiches: any[];

  panel: Ticket[];
  allTickets: Ticket[];

  seq: Record<string, number>;
  lastType: string | null;
}

@Injectable({ providedIn: 'root' })
export class QueueService {

  private state: AppState = {
    clock: SHIFT_START,
    running: false,
    speed: 1,

    queues: { SP: [], SG: [], SE: [] },
    guiches: GUICHES.map(id => ({
      id,
      busy: false,
      freeAt: SHIFT_START,
      currentTicket: null
    })),

    panel: [],
    allTickets: [],
    seq: { SP: 0, SG: 0, SE: 0 },
    lastType: null,
  };

  private subject = new BehaviorSubject<AppState>(this.state);
  state$ = this.subject.asObservable();

  private emit() {
    this.subject.next({ ...this.state });
  }

  // ─── EMIT TICKET ───
  emitTicket(type: 'SP' | 'SG' | 'SE') {
    const seq = ++this.state.seq[type];
    const ticket: Ticket = {
      id: buildTicketId(type, seq),
      type,
      seq,
      emittedAt: this.state.clock,
      skipped: Math.random() < 0.05
    };

    this.state.queues[type].push(ticket);
    this.state.allTickets.push(ticket);

    this.emit();
  }

  // ─── START / PAUSE ───
  toggleRun() {
    this.state.running = !this.state.running;
    this.emit();
  }

  reset() {
    this.state = {
      clock: SHIFT_START,
      running: false,
      speed: 1,
      queues: { SP: [], SG: [], SE: [] },
      guiches: GUICHES.map(id => ({
        id,
        busy: false,
        freeAt: SHIFT_START,
        currentTicket: null
      })),
      panel: [],
      allTickets: [],
      seq: { SP: 0, SG: 0, SE: 0 },
      lastType: null,
    };
    this.emit();
  }

  // ─── TICK (SIMULAÇÃO) ───
  tick() {
    if (!this.state.running || this.state.clock >= SHIFT_END) return;

    this.state.clock += (1 / 60) * this.state.speed;

    // liberar guichês
    this.state.guiches = this.state.guiches.map(g => {
      if (g.busy && this.state.clock >= g.freeAt) {
        return { ...g, busy: false, currentTicket: null };
      }
      return g;
    });

    const getNext = () => {
      if (this.state.queues.SP.length) return "SP";
      if (this.state.queues.SE.length) return "SE";
      if (this.state.queues.SG.length) return "SG";
      return null;
    };

    const free = this.state.guiches.filter(g => !g.busy);

    for (const g of free) {
      const type = getNext();
      if (!type) break;

      const ticket = this.state.queues[type].shift();
      if (!ticket) break;

      const tm = randomTM(type);
      const freeAt = this.state.clock + tm;

      const updated = {
        ...ticket,
        calledAt: this.state.clock,
        guiche: g.id,
        tm
      };

      g.busy = true;
      g.freeAt = freeAt;
      g.currentTicket = updated;

      this.state.panel.unshift(updated);
      this.state.panel = this.state.panel.slice(0, PANEL_SIZE);

      this.state.allTickets = this.state.allTickets.map(t =>
        t.id === ticket.id ? updated : t
      );
    }

    this.emit();
  }

  formatMinutes = formatMinutes;
}