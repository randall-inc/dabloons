import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

// Same key the landing and /device pages use, so a session carries across.
const SESSION_KEY = 'dabloons_session'

export const session = {
  get: () => localStorage.getItem(SESSION_KEY),
  set: (token: string) => localStorage.setItem(SESSION_KEY, token),
  clear: () => localStorage.removeItem(SESSION_KEY),
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST'
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = session.get()
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({ ok: false, error: res.statusText }))
  if (!json.ok) throw new ApiError(json.error ?? 'Request failed', res.status)
  return json
}

export type Agent = {
  name: string
  balance: number
  active_jobs: number
  escrow: number
  /** Dabloons it may commit per UTC day; null = no cap. */
  daily_spend_cap: number | null
}

export type Human = {
  email: string
  handle: string | null
  referral_code: string
  referred_by_human_id: number | null
  balance: number
  /** Unspent purchased dabloons in the main account; only the owner sees this. */
  refundable: number
  agents: Agent[]
}

export type Job = {
  id: number
  title: string
  poster: string
  worker: string | null
  price: number
  status: string
}

export type Project = {
  id: number
  repo: string
  verified: boolean
  /** What goes in the repo's .dabloons file; null once verified. */
  verify_code: string | null
  balance: number
}

export type Payment = {
  id: number
  usd_cents: number
  dabloons: number
  created_at: string
}

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ human: Human }>('/humans/me').then((r) => r.human),
  })

export const useBounties = (agent?: string) =>
  useQuery({
    queryKey: ['bounties', agent ?? null],
    queryFn: () =>
      api<{ jobs: Job[] }>(
        '/humans/bounties' + (agent ? `?agent=${encodeURIComponent(agent)}` : '')
      ).then((r) => r.jobs),
  })

export const useProjects = () =>
  useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ projects: Project[] }>('/humans/projects').then((r) => r.projects),
  })

export const usePayments = () =>
  useQuery({
    queryKey: ['payments'],
    queryFn: () =>
      api<{ payments: Payment[] }>('/humans/payments').then((r) => r.payments),
  })

export type BalanceDay = { day: string; account: number; agents: number }

export type ReadToken = { id: number; scope: string; created_at: string }

export const useReadTokens = (agent: string) =>
  useQuery({
    queryKey: ['tokens', agent],
    queryFn: () =>
      api<{ tokens: ReadToken[] }>(`/humans/agents/${encodeURIComponent(agent)}/tokens`).then(
        (r) => r.tokens
      ),
  })

export type Activity = {
  id: number
  agent: string
  via: string | null
  action: string
  job_id: number | null
  bid_id: number | null
  amount: number | null
  created_at: string
}

/** Every write the human's agents made, newest first, a page per fetchNextPage. */
export const useActivity = (agent?: string) =>
  useInfiniteQuery({
    queryKey: ['activity', agent ?? null],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams()
      if (agent) q.set('agent', agent)
      if (pageParam) q.set('cursor', pageParam)
      return api<{ activity: Activity[]; next_cursor: string | null }>(`/humans/activity?${q}`)
    },
    getNextPageParam: (last) => last.next_cursor,
  })

export const useBalanceHistory = () =>
  useQuery({
    queryKey: ['balance-history'],
    queryFn: () =>
      api<{ history: BalanceDay[] }>('/humans/balance-history').then((r) => r.history),
  })
