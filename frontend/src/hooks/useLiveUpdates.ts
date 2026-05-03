/** Open an SSE connection to /api/events and invalidate react-query caches on push. */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useLiveUpdates() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('state', (e) => {
      try {
        const { projectId } = JSON.parse((e as MessageEvent).data);
        qc.invalidateQueries({ queryKey: ['sessions'] });
        if (projectId) qc.invalidateQueries({ queryKey: ['state', projectId] });
      } catch {
        // ignore malformed payloads
      }
    });
    es.addEventListener('sessions', () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['registry'] });
    });
    es.addEventListener('doc', (e) => {
      try {
        const { projectId, doc } = JSON.parse((e as MessageEvent).data);
        if (projectId && doc) {
          qc.invalidateQueries({ queryKey: ['doc', doc, projectId] });
        }
      } catch {
        // ignore malformed payloads
      }
    });
    // EventSource auto-reconnects on error; no manual handling needed.
    return () => es.close();
  }, [qc]);
}
