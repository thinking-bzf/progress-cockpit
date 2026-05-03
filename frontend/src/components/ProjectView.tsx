import { useEffect } from 'react';
import type { Card, SessionSummary } from '../types';
import { useProjectDoc } from '../api';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Kanban } from './Kanban';
import { DocView } from './DocView';

type Tab = 'cards' | 'context' | 'journal';

const TABS: { value: Tab; label: string }[] = [
  { value: 'cards', label: 'Cards' },
  { value: 'context', label: 'Context' },
  { value: 'journal', label: 'Journal' },
];

export function ProjectView(props: {
  projectId: string;
  cards: Card[];
  loading: boolean;
  selectedCardId: string | null;
  onSelectCard: (id: string | null) => void;
  session: SessionSummary | undefined;
}) {
  const [tab, setTab] = useLocalStorage<Tab>('pc:projectTab', 'cards');

  // Switching away from the cards tab closes the detail panel — it would
  // overlay a markdown view that has no concept of selection otherwise.
  useEffect(() => {
    if (tab !== 'cards' && props.selectedCardId) {
      props.onSelectCard(null);
    }
  }, [tab, props.selectedCardId, props.onSelectCard]);

  // Prefetch doc presence so tabs can show a subtle indicator when empty.
  const contextDoc = useProjectDoc(props.projectId, 'context');
  const journalDoc = useProjectDoc(props.projectId, 'journal');
  const docExists: Record<Tab, boolean | undefined> = {
    cards: undefined,
    context: contextDoc.data?.exists,
    journal: journalDoc.data?.exists,
  };

  const cardsByStatus = {
    completed: props.cards.filter((c) => c.status === 'completed').length,
    in_progress: props.cards.filter((c) => c.status === 'in_progress').length,
    pending: props.cards.filter((c) => c.status === 'pending').length,
  };

  const meta =
    tab === 'cards'
      ? `${props.session?.project ?? ''} · ${props.cards.length} cards · ${cardsByStatus.completed} done · ${cardsByStatus.in_progress} doing · ${cardsByStatus.pending} todo`
      : tab === 'context'
        ? formatDocMeta(props.session?.project, contextDoc.data)
        : formatDocMeta(props.session?.project, journalDoc.data);

  return (
    <>
      <header className="view-header view-header-tabs">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="view-title">{props.session?.name ?? props.projectId}</h1>
          <p className="view-meta">{meta}</p>
        </div>
        <nav className="project-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              className={`tab ${tab === t.value ? 'active' : ''}`}
              onClick={() => setTab(t.value)}
            >
              {t.label}
              {docExists[t.value] === false && <span className="tab-empty-dot" aria-hidden />}
            </button>
          ))}
        </nav>
      </header>
      {tab === 'cards' && (
        <Kanban
          projectId={props.projectId}
          cards={props.cards}
          loading={props.loading}
          selectedCardId={props.selectedCardId}
          onSelectCard={props.onSelectCard}
        />
      )}
      {tab === 'context' && <DocView projectId={props.projectId} kind="context" />}
      {tab === 'journal' && <DocView projectId={props.projectId} kind="journal" />}
    </>
  );
}

function formatDocMeta(
  project: string | null | undefined,
  doc: { exists: boolean; mtime: number | null } | undefined,
): string {
  const base = project ?? '';
  if (!doc) return base;
  if (!doc.exists) return `${base} · not present`;
  if (doc.mtime == null) return base;
  return `${base} · updated ${formatRelative(doc.mtime)}`;
}

function formatRelative(epochSeconds: number): string {
  const deltaSec = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (deltaSec < 60) return 'just now';
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}
