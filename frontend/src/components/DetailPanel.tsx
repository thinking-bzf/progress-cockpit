import { useEffect, useRef, useState } from 'react';
import type { Card, Finding, Reference, Status, Subtask } from '../types';
import {
  findingMutations,
  referenceMutations,
  subtaskMutations,
  useDeleteCard,
  useUpdateCard,
} from '../api';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Markdown } from '../markdown';
import { useDialog } from './Dialog';

type EditMode =
  | null
  | { kind: 'card' }
  | { kind: 'subtask'; id: string }
  | { kind: 'reference'; id: string }
  | { kind: 'finding'; id: string };

export function DetailPanel(props: {
  projectId: string;
  card: Card;
  allCards: Card[];
  onClose: () => void;
}) {
  const [width, setWidth] = useLocalStorage<number>('detailPanelWidth', 420);
  const [mode, setMode] = useState<EditMode>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Reset edit mode whenever the selected card changes
  useEffect(() => setMode(null), [props.card.id]);

  // Expose panel width to the kanban so it can render a spacer that pushes
  // the rightmost column past the area the panel covers — making horizontal
  // scroll possible to reveal the otherwise-hidden columns.
  useEffect(() => {
    document.documentElement.style.setProperty('--detail-width', `${width}px`);
    return () => {
      document.documentElement.style.setProperty('--detail-width', '0px');
    };
  }, [width]);

  // Drag-to-resize on left edge
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = ref.current?.getBoundingClientRect().width ?? width;
    document.body.classList.add('col-resizing');

    function onMove(ev: MouseEvent) {
      const delta = startX - ev.clientX;
      const w = Math.max(320, Math.min(window.innerWidth * 0.8, startW + delta));
      setWidth(Math.round(w));
    }
    function onUp() {
      document.body.classList.remove('col-resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <aside ref={ref} className="detail-panel" style={{ width }}>
      <div className="detail-resizer" onMouseDown={startResize} />
      <header className="detail-header">
        <h3>Card Details</h3>
        <button className="detail-close" onClick={props.onClose} title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>
      <div className="detail-content">
        {mode?.kind === 'card' ? (
          <EditCardForm
            projectId={props.projectId}
            card={props.card}
            onDone={() => setMode(null)}
          />
        ) : mode?.kind === 'subtask' ? (
          <EditSubtaskForm
            projectId={props.projectId}
            card={props.card}
            sub={props.card.subtasks.find((s) => s.id === mode.id)!}
            onDone={() => setMode(null)}
          />
        ) : mode?.kind === 'reference' ? (
          <EditReferenceForm
            projectId={props.projectId}
            cardId={props.card.id}
            ref0={props.card.references.find((r) => r.id === mode.id)!}
            onDone={() => setMode(null)}
          />
        ) : mode?.kind === 'finding' ? (
          <EditFindingForm
            projectId={props.projectId}
            cardId={props.card.id}
            finding={props.card.findings.find((f) => f.id === mode.id)!}
            onDone={() => setMode(null)}
          />
        ) : (
          <CardView
            projectId={props.projectId}
            card={props.card}
            onEdit={(m) => setMode(m)}
          />
        )}
      </div>
    </aside>
  );
}

// =========================================================================
// Read view
// =========================================================================

function CardView(props: {
  projectId: string;
  card: Card;
  onEdit: (mode: EditMode) => void;
}) {
  const { card } = props;
  const deleteCard = useDeleteCard(props.projectId);
  const updateCard = useUpdateCard(props.projectId);
  const subM = subtaskMutations(props.projectId);
  const refM = referenceMutations(props.projectId);
  const findM = findingMutations(props.projectId);

  const subCreate = subM.useCreate();
  const subUpdate = subM.useUpdate();
  const subDelete = subM.useDelete();
  const refCreate = refM.useCreate();
  const refDelete = refM.useDelete();
  const findCreate = findM.useCreate();
  const findDelete = findM.useDelete();
  const dialog = useDialog();

  async function handleDelete() {
    const ok = await dialog.confirm({
      title: 'Delete card',
      message: `确定删除卡片 "${card.title}"?\n这张卡的 subtasks / references / findings 也会一起删除。`,
      danger: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    deleteCard.mutate(card.id);
  }

  async function addSubtask() {
    const title = await dialog.prompt({
      title: '新建子任务',
      label: '标题',
      placeholder: '一句话描述要做什么',
      required: true,
      submitLabel: 'Create',
    });
    if (!title?.trim()) return;
    await subCreate.mutateAsync({ cardId: card.id, payload: { title: title.trim() } });
  }
  async function addReference() {
    const v = await dialog.form<{ title: string; url: string; note: string }>({
      title: '新建参考资料',
      submitLabel: 'Create',
      fields: [
        { name: 'title', label: '标题', placeholder: 'RFC / 文档 / 设计稿名', required: true },
        { name: 'url', label: '链接', placeholder: 'https://… 或 docs/foo.md', type: 'url' },
        { name: 'note', label: '备注', placeholder: '为什么重要 / 看哪里', multiline: true, rows: 3 },
      ],
    });
    if (!v) return;
    await refCreate.mutateAsync({
      cardId: card.id,
      payload: { title: v.title.trim(), url: v.url.trim(), note: v.note.trim() },
    });
  }
  async function addFinding() {
    const v = await dialog.form<{ title: string; body: string }>({
      title: '新建调研成果',
      message: '看完文档/RFC 的结论,或探完代码的关键事实。累积式,带时间戳。',
      submitLabel: 'Create',
      fields: [
        {
          name: 'title',
          label: '一行摘要 (可选)',
          placeholder: '譬如 "ChannelService 是 process-global 单例"',
        },
        {
          name: 'body',
          label: '正文 (markdown)',
          placeholder: '`service.py:177` …',
          multiline: true,
          rows: 8,
          required: true,
          hint: '⌘/Ctrl + Enter 提交',
        },
      ],
    });
    if (!v) return;
    await findCreate.mutateAsync({
      cardId: card.id,
      payload: { title: v.title.trim(), body: v.body.trim() },
    });
  }

  return (
    <>
      <div className="detail-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="detail-label">Card #{card.id.slice(2, 8)}</div>
            <h2 className="detail-title">{card.title}</h2>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              className="icon-btn"
              title="Edit card"
              style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
              onClick={() => props.onEdit({ kind: 'card' })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button className="icon-btn danger" title="Delete card" onClick={handleDelete}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-label">Status</div>
        <span className={`detail-status ${card.status}`}>
          <span className="dot"></span>
          {card.status === 'in_progress' ? 'In Progress' : card.status === 'pending' ? 'Pending' : 'Completed'}
        </span>
        {card.blocked && (
          <span className="badge blocked" style={{ marginLeft: 8 }}>
            Blocked
          </span>
        )}
        {card.section && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            section · {card.section}
          </div>
        )}
      </div>

      <div className="detail-section">
        <div className="detail-label">Requirement (body)</div>
        {card.body?.trim() ? (
          <Markdown source={card.body} />
        ) : (
          <em className="nested-empty-inline">（无描述,点 Edit 补全）</em>
        )}
      </div>

      <SubtaskSection
        card={card}
        onAdd={addSubtask}
        onToggleDone={(s) =>
          subUpdate.mutate({
            cardId: card.id,
            itemId: s.id,
            patch: { done: !s.done },
          })
        }
        onEdit={(s) => props.onEdit({ kind: 'subtask', id: s.id })}
        onDelete={async (s) => {
          const ok = await dialog.confirm({
            title: '删除子任务',
            message: `"${s.title}"`,
            danger: true,
            confirmLabel: 'Delete',
          });
          if (!ok) return;
          subDelete.mutate({ cardId: card.id, itemId: s.id });
        }}
      />

      <ReferenceSection
        card={card}
        onAdd={addReference}
        onEdit={(r) => props.onEdit({ kind: 'reference', id: r.id })}
        onDelete={async (r) => {
          const ok = await dialog.confirm({
            title: '删除参考资料',
            message: `"${r.title}"`,
            danger: true,
            confirmLabel: 'Delete',
          });
          if (!ok) return;
          refDelete.mutate({ cardId: card.id, itemId: r.id });
        }}
      />

      <FindingSection
        card={card}
        onAdd={addFinding}
        onEdit={(f) => props.onEdit({ kind: 'finding', id: f.id })}
        onDelete={async (f) => {
          const ok = await dialog.confirm({
            title: '删除调研成果',
            message: f.title || '(untitled)',
            danger: true,
            confirmLabel: 'Delete',
          });
          if (!ok) return;
          findDelete.mutate({ cardId: card.id, itemId: f.id });
        }}
      />

      <div className="detail-section">
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          <input
            type="checkbox"
            checked={card.blocked}
            onChange={(e) =>
              updateCard.mutate({ cardId: card.id, patch: { blocked: e.target.checked } })
            }
          />
          mark whole card as blocked (waiting on external)
        </label>
      </div>
    </>
  );
}

// =========================================================================
// Subtask section
// =========================================================================

function SubtaskSection(props: {
  card: Card;
  onAdd: () => void;
  onToggleDone: (s: Subtask) => void;
  onEdit: (s: Subtask) => void;
  onDelete: (s: Subtask) => void;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const subs = props.card.subtasks;
  const byId = Object.fromEntries(subs.map((s) => [s.id, s]));

  function toggleOpen(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="detail-section">
      <div className="detail-section-header">
        <div className="detail-label">
          Subtasks <span className="counter">{subs.length}</span>
        </div>
        <button className="add-card-btn" onClick={props.onAdd} title="Add subtask">
          +
        </button>
      </div>
      {subs.length === 0 ? (
        <div className="nested-empty">（暂无子任务）</div>
      ) : (
        subs.map((s) => {
          const blockedByLabels = s.blockedBy
            .map((bid) =>
              byId[bid] ? `#${bid.slice(2, 7)} ${byId[bid].title.slice(0, 30)}` : bid,
            )
            .join(', ');
          const blocksList = subs
            .filter((o) => o.blockedBy.includes(s.id))
            .map((o) => `#${o.id.slice(2, 7)} ${o.title.slice(0, 30)}`)
            .join(', ');
          const isBlocked = s.blockedBy.some((bid) => byId[bid] && !byId[bid].done);
          const dotCls = s.done ? 'done' : isBlocked ? 'blocked' : 'pending';
          const open = openIds.has(s.id);
          return (
            <div key={s.id} className={`nested-item ${s.done ? 'is-done' : ''}`}>
              <div className="nested-row">
                <input
                  type="checkbox"
                  checked={s.done}
                  onChange={() => props.onToggleDone(s)}
                />
                <div className="nested-title-wrap">
                  <span className={`nested-status-dot ${dotCls}`} />
                  <span className="nested-title">{s.title}</span>
                  {blockedByLabels && <span className="nested-meta">⛔ {blockedByLabels}</span>}
                  {blocksList && <span className="nested-meta">→ blocks {blocksList}</span>}
                </div>
                <button
                  className={`nested-toggle ${open ? 'expanded' : ''}`}
                  onClick={() => toggleOpen(s.id)}
                  title="Expand"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
              {open && (
                <div className="nested-body">
                  {s.body?.trim() ? (
                    <Markdown source={s.body} />
                  ) : (
                    <em className="nested-empty-inline">（无详情）</em>
                  )}
                  <div className="nested-actions">
                    <button onClick={() => props.onEdit(s)}>Edit</button>
                    <button className="danger" onClick={() => props.onDelete(s)}>
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// =========================================================================
// Reference section
// =========================================================================

function ReferenceSection(props: {
  card: Card;
  onAdd: () => void;
  onEdit: (r: Reference) => void;
  onDelete: (r: Reference) => void;
}) {
  const refs = props.card.references;
  return (
    <div className="detail-section">
      <div className="detail-section-header">
        <div className="detail-label">
          References <span className="counter">{refs.length}</span>
        </div>
        <button className="add-card-btn" onClick={props.onAdd} title="Add reference">
          +
        </button>
      </div>
      {refs.length === 0 ? (
        <div className="nested-empty">（暂无参考资料）</div>
      ) : (
        refs.map((r) => (
          <div key={r.id} className="nested-item">
            <div className="nested-row">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                width="14"
                height="14"
                style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}
              >
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              </svg>
              <div className="nested-title-wrap">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noopener" className="nested-title">
                    {r.title}
                  </a>
                ) : (
                  <span className="nested-title">{r.title}</span>
                )}
                {r.note && <span className="nested-meta">{r.note}</span>}
              </div>
              <div className="nested-actions inline">
                <button onClick={() => props.onEdit(r)}>Edit</button>
                <button className="danger" onClick={() => props.onDelete(r)}>
                  Del
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// =========================================================================
// Finding section
// =========================================================================

function FindingSection(props: {
  card: Card;
  onAdd: () => void;
  onEdit: (f: Finding) => void;
  onDelete: (f: Finding) => void;
}) {
  const fs = props.card.findings;
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setOpenIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  return (
    <div className="detail-section">
      <div className="detail-section-header">
        <div className="detail-label">
          Findings <span className="counter">{fs.length}</span>
        </div>
        <button className="add-card-btn" onClick={props.onAdd} title="Add finding">
          +
        </button>
      </div>
      {fs.length === 0 ? (
        <div className="nested-empty">（暂无调研成果）</div>
      ) : (
        fs.map((f) => {
          const ts = (f.updatedAt || f.createdAt || '').slice(0, 16).replace('T', ' ');
          const open = openIds.has(f.id);
          return (
            <div key={f.id} className="nested-item">
              <div className="nested-row">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  width="14"
                  height="14"
                  style={{ flexShrink: 0, color: 'var(--accent)' }}
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m6.36 6.36l4.24 4.24M1 12h6m6 0h6" />
                </svg>
                <div className="nested-title-wrap">
                  <span className="nested-title">{f.title || '(untitled)'}</span>
                  <span className="nested-meta">{ts}</span>
                </div>
                <button
                  className={`nested-toggle ${open ? 'expanded' : ''}`}
                  onClick={() => toggle(f.id)}
                  title="Expand"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
              {open && (
                <div className="nested-body">
                  {f.body?.trim() ? <Markdown source={f.body} /> : <em>（空）</em>}
                  <div className="nested-actions">
                    <button onClick={() => props.onEdit(f)}>Edit</button>
                    <button className="danger" onClick={() => props.onDelete(f)}>
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// =========================================================================
// Edit forms
// =========================================================================

function EditCardForm(props: { projectId: string; card: Card; onDone: () => void }) {
  const update = useUpdateCard(props.projectId);
  const [title, setTitle] = useState(props.card.title);
  const [status, setStatus] = useState<Status>(props.card.status);
  const [blocked, setBlocked] = useState(props.card.blocked);
  const [section, setSection] = useState(props.card.section);
  const [body, setBody] = useState(props.card.body);

  async function save() {
    await update.mutateAsync({
      cardId: props.card.id,
      patch: { title, status, blocked, section, body },
    });
    props.onDone();
  }

  return (
    <>
      <div className="detail-section">
        <div className="detail-label">Editing Card #{props.card.id.slice(2, 8)}</div>
      </div>
      <div className="form-row">
        <label>Title</label>
        <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="form-row">
        <label>Status</label>
        <select
          className="form-select"
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
        >
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      <div className="form-row">
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            textTransform: 'none',
            letterSpacing: 0,
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />
          card is blocked (waiting on external condition)
        </label>
      </div>
      <div className="form-row">
        <label>Section (optional grouping)</label>
        <input className="form-input" value={section} onChange={(e) => setSection(e.target.value)} />
      </div>
      <div className="form-row">
        <label>Body (markdown)</label>
        <textarea
          className="form-textarea"
          rows={14}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="form-actions">
        <button className="btn primary" onClick={save} disabled={update.isPending}>
          Save
        </button>
        <button className="btn" onClick={props.onDone}>
          Cancel
        </button>
      </div>
    </>
  );
}

function EditSubtaskForm(props: {
  projectId: string;
  card: Card;
  sub: Subtask;
  onDone: () => void;
}) {
  const m = subtaskMutations(props.projectId).useUpdate();
  const [title, setTitle] = useState(props.sub.title);
  const [done, setDone] = useState(props.sub.done);
  const [body, setBody] = useState(props.sub.body);
  const [blockedBy, setBlockedBy] = useState<string[]>(props.sub.blockedBy);

  const siblings = props.card.subtasks.filter((s) => s.id !== props.sub.id);

  function toggleDep(id: string) {
    setBlockedBy((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function save() {
    await m.mutateAsync({
      cardId: props.card.id,
      itemId: props.sub.id,
      patch: { title, done, body, blockedBy },
    });
    props.onDone();
  }

  return (
    <>
      <div className="detail-section">
        <div className="detail-label">Editing Subtask</div>
      </div>
      <div className="form-row">
        <label>Title</label>
        <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="form-row">
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            textTransform: 'none',
            letterSpacing: 0,
            fontSize: 12,
          }}
        >
          <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> done
        </label>
      </div>
      <div className="form-row">
        <label>Body (markdown)</label>
        <textarea
          className="form-textarea"
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="form-row">
        <label>Blocked By (sibling subtasks)</label>
        {siblings.length === 0 ? (
          <em className="nested-empty-inline">（暂无其他子任务可依赖）</em>
        ) : (
          <div className="dep-list">
            {siblings.map((s) => (
              <label key={s.id} className="dep-check">
                <input
                  type="checkbox"
                  checked={blockedBy.includes(s.id)}
                  onChange={() => toggleDep(s.id)}
                />
                {s.title}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="form-actions">
        <button className="btn primary" onClick={save} disabled={m.isPending}>
          Save
        </button>
        <button className="btn" onClick={props.onDone}>
          Cancel
        </button>
      </div>
    </>
  );
}

function EditReferenceForm(props: {
  projectId: string;
  cardId: string;
  ref0: Reference;
  onDone: () => void;
}) {
  const m = referenceMutations(props.projectId).useUpdate();
  const [title, setTitle] = useState(props.ref0.title);
  const [url, setUrl] = useState(props.ref0.url);
  const [note, setNote] = useState(props.ref0.note);

  async function save() {
    await m.mutateAsync({
      cardId: props.cardId,
      itemId: props.ref0.id,
      patch: { title, url, note },
    });
    props.onDone();
  }

  return (
    <>
      <div className="detail-section">
        <div className="detail-label">Editing Reference</div>
      </div>
      <div className="form-row">
        <label>Title</label>
        <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="form-row">
        <label>URL</label>
        <input className="form-input" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="form-row">
        <label>Note</label>
        <textarea
          className="form-textarea"
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="form-actions">
        <button className="btn primary" onClick={save} disabled={m.isPending}>
          Save
        </button>
        <button className="btn" onClick={props.onDone}>
          Cancel
        </button>
      </div>
    </>
  );
}

function EditFindingForm(props: {
  projectId: string;
  cardId: string;
  finding: Finding;
  onDone: () => void;
}) {
  const m = findingMutations(props.projectId).useUpdate();
  const [title, setTitle] = useState(props.finding.title);
  const [body, setBody] = useState(props.finding.body);

  async function save() {
    await m.mutateAsync({
      cardId: props.cardId,
      itemId: props.finding.id,
      patch: { title, body },
    });
    props.onDone();
  }

  return (
    <>
      <div className="detail-section">
        <div className="detail-label">Editing Finding</div>
      </div>
      <div className="form-row">
        <label>Title (optional)</label>
        <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="form-row">
        <label>Body (markdown)</label>
        <textarea
          className="form-textarea"
          rows={14}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="form-actions">
        <button className="btn primary" onClick={save} disabled={m.isPending}>
          Save
        </button>
        <button className="btn" onClick={props.onDone}>
          Cancel
        </button>
      </div>
    </>
  );
}
