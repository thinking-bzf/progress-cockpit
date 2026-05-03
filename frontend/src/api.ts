/** API client + react-query hooks for the FastAPI backend. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Card,
  Finding,
  ProgressState,
  Reference,
  SessionSummary,
  Status,
  Subtask,
} from './types';

const BASE = '/api';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- queries ----------------------------------------------------------

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => req<SessionSummary[]>('GET', '/sessions?limit=all'),
    staleTime: 5_000,
  });
}

export function useProjectState(projectId: string | null) {
  return useQuery({
    queryKey: ['state', projectId],
    queryFn: () => req<ProgressState>('GET', `/projects/${projectId}/state`),
    enabled: !!projectId,
    staleTime: 2_000,
  });
}

export type DocKind = 'journal' | 'context';

export interface ProjectDoc {
  exists: boolean;
  content: string;
  mtime: number | null;
  path: string | null;
}

export function useProjectDoc(projectId: string | null, kind: DocKind) {
  return useQuery({
    queryKey: ['doc', kind, projectId],
    queryFn: () => req<ProjectDoc>('GET', `/projects/${projectId}/doc/${kind}`),
    enabled: !!projectId,
    staleTime: 2_000,
  });
}

// ---- mutations: card --------------------------------------------------

function useInvalidate(projectId: string | null) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['sessions'] });
    if (projectId) qc.invalidateQueries({ queryKey: ['state', projectId] });
  };
}

export function useCreateCard(projectId: string | null) {
  const inv = useInvalidate(projectId);
  return useMutation({
    mutationFn: (payload: Partial<Card>) =>
      req<Card>('POST', `/projects/${projectId}/cards`, payload),
    onSuccess: inv,
  });
}

export function useUpdateCard(projectId: string | null) {
  const inv = useInvalidate(projectId);
  return useMutation({
    mutationFn: ({ cardId, patch }: { cardId: string; patch: Partial<Card> }) =>
      req<Card>('PUT', `/projects/${projectId}/cards/${cardId}`, patch),
    onSuccess: inv,
  });
}

export function useDeleteCard(projectId: string | null) {
  const inv = useInvalidate(projectId);
  return useMutation({
    mutationFn: (cardId: string) =>
      req<{ deleted: string }>('DELETE', `/projects/${projectId}/cards/${cardId}`),
    onSuccess: inv,
  });
}

// ---- nested mutations -------------------------------------------------

type Kind = 'subtasks' | 'references' | 'findings';

function nestedMutations<T>(kind: Kind, projectId: string | null) {
  // returns 3 hooks (create / update / delete) for the given nested kind
  return {
    useCreate: () => {
      const inv = useInvalidate(projectId);
      return useMutation({
        mutationFn: ({ cardId, payload }: { cardId: string; payload: Partial<T> }) =>
          req<T>('POST', `/projects/${projectId}/cards/${cardId}/${kind}`, payload),
        onSuccess: inv,
      });
    },
    useUpdate: () => {
      const inv = useInvalidate(projectId);
      return useMutation({
        mutationFn: ({
          cardId,
          itemId,
          patch,
        }: {
          cardId: string;
          itemId: string;
          patch: Partial<T>;
        }) =>
          req<T>(
            'PUT',
            `/projects/${projectId}/cards/${cardId}/${kind}/${itemId}`,
            patch,
          ),
        onSuccess: inv,
      });
    },
    useDelete: () => {
      const inv = useInvalidate(projectId);
      return useMutation({
        mutationFn: ({ cardId, itemId }: { cardId: string; itemId: string }) =>
          req<{ deleted: string }>(
            'DELETE',
            `/projects/${projectId}/cards/${cardId}/${kind}/${itemId}`,
          ),
        onSuccess: inv,
      });
    },
  };
}

export const subtaskMutations = (projectId: string | null) =>
  nestedMutations<Subtask>('subtasks', projectId);
export const referenceMutations = (projectId: string | null) =>
  nestedMutations<Reference>('references', projectId);
export const findingMutations = (projectId: string | null) =>
  nestedMutations<Finding>('findings', projectId);

// ---- helpers ----------------------------------------------------------

export const statusLabel: Record<Status, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
};

export const STATUSES: Status[] = ['pending', 'in_progress', 'completed'];

/**
 * Rewrite a reference URL so relative paths route through the backend's
 * project-file endpoint (which serves files from inside the project root).
 * External URLs (with a scheme like `https:` / `mailto:`) pass through
 * untouched. Empty input returns empty string.
 */
export function resolveRefUrl(url: string, projectId: string | null): string {
  if (!url) return '';
  // Has a URL scheme like http(s):, mailto:, ftp:, file:, etc.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (!projectId) return url;
  // Strip a leading "./" for cleanliness; preserve everything else verbatim.
  const clean = url.replace(/^\.\//, '');
  return `${BASE}/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(clean)}`;
}

// ---- registry --------------------------------------------------------

export interface RegistryEntry {
  id: string;
  path: string;
}

export function useRegistry() {
  return useQuery({
    queryKey: ['registry'],
    queryFn: () => req<RegistryEntry[]>('GET', '/projects/registry'),
  });
}

export function useAddProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { path: string; id?: string }) =>
      req<RegistryEntry>('POST', '/projects/registry', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['registry'] });
    },
  });
}

export function useRemoveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      req<{ removed: string }>('DELETE', `/projects/registry/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['registry'] });
    },
  });
}
