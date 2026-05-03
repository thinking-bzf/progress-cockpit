import { type DocKind, useProjectDoc } from '../api';
import { Markdown } from '../markdown';

const TITLES: Record<DocKind, string> = {
  context: 'CONTEXT.md',
  journal: 'JOURNAL.md',
};

const EMPTY_HINTS: Record<DocKind, string> = {
  context:
    'No CONTEXT.md yet. Create `.claude-progress/CONTEXT.md` in the project root to capture stable background that should always be visible.',
  journal:
    'No JOURNAL.md yet. Create `.claude-progress/JOURNAL.md` in the project root to log dated entries (newest on top).',
};

export function DocView({
  projectId,
  kind,
}: {
  projectId: string;
  kind: DocKind;
}) {
  const q = useProjectDoc(projectId, kind);
  const doc = q.data;

  if (q.isLoading) {
    return <div className="doc-view doc-empty">Loading {TITLES[kind]}…</div>;
  }
  if (q.isError) {
    return (
      <div className="doc-view doc-empty">
        Failed to load {TITLES[kind]}: {(q.error as Error)?.message ?? 'unknown error'}
      </div>
    );
  }
  if (!doc?.exists) {
    return (
      <div className="doc-view doc-empty">
        <p>{EMPTY_HINTS[kind]}</p>
        {doc?.path && <code className="doc-path">{doc.path}</code>}
      </div>
    );
  }
  return (
    <div className="doc-view">
      <Markdown source={doc.content} projectId={projectId} />
    </div>
  );
}
