import { useEffect, useState } from 'react';

/* One request for the solver list, shared by every component that wants it.
   The hero's stat row and the composer's header both mount at first paint;
   without this they would race two identical fetches at the aggregator. */

export interface SolverSummary {
  solverId: string;
  name?: string;
  adapterId?: string;
  status?: string;
  lastSeen?: string;
}

let cache: SolverSummary[] | null = null;
let inflight: Promise<SolverSummary[]> | null = null;

async function fetchSolvers(): Promise<SolverSummary[]> {
  if (cache) return cache;
  if (inflight) return inflight;

  const base = (import.meta.env.VITE_OIF_API_BASE_URL as string | undefined)?.replace(/\/$/, '');
  if (!base) return Promise.reject(new Error('VITE_OIF_API_BASE_URL unset'));

  inflight = fetch(`${base}/api/v1/solvers`)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(d => {
      cache = Array.isArray(d) ? d : (d?.solvers ?? []);
      return cache as SolverSummary[];
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function useSolvers() {
  const [solvers, setSolvers] = useState<SolverSummary[] | null>(cache);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchSolvers()
      .then(s => { if (alive) setSolvers(s); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const active = (solvers ?? []).filter(s => s.status === 'active').length;
  return { solvers, activeCount: solvers ? active : null, failed };
}
