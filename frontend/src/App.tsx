import { useEffect, useMemo, useState } from 'react';
import { Layout } from './components/Layout';
import { Sidebar } from './components/Sidebar';
import { Kanban } from './components/Kanban';
import { DetailPanel } from './components/DetailPanel';
import { useProjectState, useSessions } from './api';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useLiveUpdates } from './hooks/useLiveUpdates';

export default function App() {
  useLiveUpdates();
  const sessionsQ = useSessions();
  const [projectId, setProjectId] = useLocalStorage<string | null>('projectId', null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Auto-select the most recent project on first load
  useEffect(() => {
    if (!projectId && sessionsQ.data && sessionsQ.data.length > 0) {
      setProjectId(sessionsQ.data[0].id);
    }
  }, [projectId, sessionsQ.data, setProjectId]);

  const stateQ = useProjectState(projectId);
  const cards = stateQ.data?.cards ?? [];
  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) ?? null,
    [cards, selectedCardId],
  );

  return (
    <Layout
      sidebar={
        <Sidebar
          sessions={sessionsQ.data ?? []}
          loading={sessionsQ.isLoading}
          activeId={projectId}
          onSelect={(id) => {
            setProjectId(id);
            setSelectedCardId(null);
          }}
        />
      }
      main={
        projectId ? (
          <Kanban
            projectId={projectId}
            cards={cards}
            loading={stateQ.isLoading}
            selectedCardId={selectedCardId}
            onSelectCard={setSelectedCardId}
            session={sessionsQ.data?.find((s) => s.id === projectId)}
          />
        ) : (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p>Select a project from the sidebar.</p>
          </div>
        )
      }
      detail={
        selectedCard && projectId ? (
          <DetailPanel
            projectId={projectId}
            card={selectedCard}
            allCards={cards}
            onClose={() => setSelectedCardId(null)}
          />
        ) : null
      }
    />
  );
}
