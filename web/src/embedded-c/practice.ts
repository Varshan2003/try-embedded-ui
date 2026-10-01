// State for the Embedded C section: the problem catalogue, the learner's drafts and what they have completed.
import { useSyncExternalStore } from 'react';
import { api, ApiError, type Problem, type ProblemList, type ProblemSummary } from '../api';
import { store } from '../store';

interface Saved {
  solved: string[];
  read: string[];                    // guides marked as read
  drafts: Record<string, string>;    // unfinished code per problem
}

const KEY = 'tryembedded:embedded-c';
// Progress recorded by the API uses this prefix to tell problems from simulator challenges.
const PROGRESS_PREFIX = 'c:';

function load(): Saved {
  const empty: Saved = { solved: [], read: [], drafts: {} };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch { return empty; }
}

class Practice {
  private listeners = new Set<() => void>();
  private version = 0;
  private saved = load();
  private pending: Promise<void> | null = null;
  private details = new Map<string, Problem>();

  catalogue: ProblemList | null = null;
  // null while loading, a message once the request has failed.
  error: string | null = null;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emit() { this.version++; this.listeners.forEach(fn => fn()); }
  private persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.saved)); } catch { /* storage unavailable */ }
  }

  loadCatalogue(force = false): Promise<void> {
    if (this.catalogue && !force) return Promise.resolve();
    this.pending ??= api.problems()
      .then(list => { this.catalogue = list; this.error = null; })
      .catch(e => { this.error = e instanceof Error ? e.message : 'The problems could not be loaded'; })
      .finally(() => { this.pending = null; this.emit(); });
    return this.pending;
  }

  async loadProblem(id: string): Promise<Problem> {
    const cached = this.details.get(id);
    if (cached) return cached;
    const problem = await api.problem(id);
    this.details.set(id, problem);
    return problem;
  }

  isSolved(id: string) { return this.saved.solved.includes(id) || !!store.progress.get(PROGRESS_PREFIX + id)?.passed; }
  markSolved(id: string) {
    if (this.saved.solved.includes(id)) return;
    this.saved.solved.push(id);
    this.persist();
    this.emit();
  }

  isRead(guide: string) { return this.saved.read.includes(guide); }
  setRead(guide: string, read: boolean) {
    this.saved.read = this.saved.read.filter(g => g !== guide);
    if (read) this.saved.read.push(guide);
    this.persist();
    this.emit();
  }

  draft(id: string): string | undefined { return this.saved.drafts[id]; }
  // Called on every keystroke, so it does not notify subscribers.
  setDraft(id: string, code: string | null) {
    if (code === null) delete this.saved.drafts[id];
    else this.saved.drafts[id] = code;
    this.persist();
  }

  problemsIn(topic: string): ProblemSummary[] {
    return this.catalogue ? this.catalogue.problems.filter(p => p.topic === topic) : [];
  }

  solvedCount(problems: ProblemSummary[]) { return problems.filter(p => this.isSolved(p.id)).length; }
}

export const practice = new Practice();

export function usePractice() {
  useSyncExternalStore(practice.subscribe, practice.getVersion);
  // Progress synced from an account lives in the main store.
  useSyncExternalStore(store.subscribe, store.getVersion);
  return practice;
}

export const describeError = (e: unknown) =>
  e instanceof ApiError && e.status === 0
    ? 'The Try Embedded API is not reachable. Start it on port 8000 to load practice problems; the guides and the playground work without it.'
    : e instanceof Error ? e.message : 'Something went wrong';
