import type { CDiagnostic, CForbidRule, CircuitComponent, Diagnostic, Wire } from '@try-embedded/simulator';

// Caps on what a passing test may cost on the simulated chip.
export interface ProblemLimits { ops: number | null; stack_bytes: number | null; heap_bytes: number | null }

// Empty in development (requests go through the Vite proxy); the API's origin in production.
const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export interface User { id: string; email: string }
export interface TokenResponse { access_token: string; user: User }

export interface ChallengeSummary {
  id: string;
  title: string;
  topic: string;
  difficulty: string;
  summary: string;
}

export interface StarterWire { comp: string; term: string; pinName: string }

export interface Challenge extends ChallengeSummary {
  prompt: string;
  circuit: 'fixed' | 'learner';
  starter: { board: string; code: string; components: CircuitComponent[]; wires: StarterWire[] };
  tests: { name: string; hidden: boolean }[];
}

export interface TestResult { name: string; hidden: boolean; passed: boolean; messages: string[] }

export interface SubmissionResult {
  challenge_id: string;
  passed: boolean;
  passed_tests: number;
  total_tests: number;
  saved: boolean;
  diagnostics: Diagnostic[];
  tests: TestResult[];
}

export interface ProgressItem {
  challenge_id: string;
  attempts: number;
  passed: boolean;
  best_passed_tests: number;
  total_tests: number;
}

export interface ProblemTopic { id: string; title: string; summary: string }

export interface ProblemSummary {
  id: string;
  title: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  summary: string;
  tags: string[];
}

export interface ProblemList { topics: ProblemTopic[]; problems: ProblemSummary[] }

// Hidden tests carry only their name; visible ones also show the call and the output it must print.
export interface ProblemTest { name: string; hidden: boolean; code: string | null; expect: string | null; stdin: string | null }

export interface Problem extends ProblemSummary {
  prompt: string;
  prelude: string;
  support: string;
  starter: string;
  tests: ProblemTest[];
  hints: string[];
  forbid: CForbidRule[];
  limits: ProblemLimits | null;
  // 'native' problems are compiled by a real compiler when submitted; Run always uses the interpreter.
  grader: 'interpreter' | 'native';
}

export interface ProblemReview { solution: string; notes: string }

export interface ProblemTestResult extends TestResult {
  stdout: string | null;
  expected: string | null;
  ops: number;
  stack_bytes: number;
  heap_bytes: number;
}

export interface ProblemSubmission {
  problem_id: string;
  passed: boolean;
  passed_tests: number;
  total_tests: number;
  saved: boolean;
  diagnostics: CDiagnostic[];
  tests: ProblemTestResult[];
  review: ProblemReview | null;
}

export interface SubmissionBody { board: string; code: string; components: CircuitComponent[]; wires: Wire[] }

function errorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(d => String(d?.msg ?? '').replace(/^Value error, /, '')).filter(Boolean).join('; ') || fallback;
  }
  return fallback;
}

async function request<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('The Try Embedded service could not be reached', 0);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(errorMessage(payload?.detail, `Request failed (${response.status})`), response.status);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  register: (email: string, password: string) => request<TokenResponse>('/auth/register', { method: 'POST', body: { email, password } }),
  login: (email: string, password: string) => request<TokenResponse>('/auth/login', { method: 'POST', body: { email, password } }),
  me: (token: string) => request<User>('/auth/me', { token }),
  challenges: () => request<ChallengeSummary[]>('/challenges'),
  challenge: (id: string) => request<Challenge>(`/challenges/${encodeURIComponent(id)}`),
  submit: (id: string, body: SubmissionBody, token: string | null) =>
    request<SubmissionResult>(`/challenges/${encodeURIComponent(id)}/submissions`, { method: 'POST', body, token }),
  progress: (token: string) => request<ProgressItem[]>('/progress', { token }),
  problems: () => request<ProblemList>('/c/problems'),
  problem: (id: string) => request<Problem>(`/c/problems/${encodeURIComponent(id)}`),
  problemSolution: (id: string) => request<ProblemReview>(`/c/problems/${encodeURIComponent(id)}/solution`),
  submitProblem: (id: string, code: string, token: string | null) =>
    request<ProblemSubmission>(`/c/problems/${encodeURIComponent(id)}/submissions`, { method: 'POST', body: { code }, token }),
};
