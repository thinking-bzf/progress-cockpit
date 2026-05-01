import { useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Card, SessionSummary, Status } from '../types';
import { STATUSES, statusLabel, useCreateCard, useUpdateCard } from '../api';
import { useDialog } from './Dialog';

export function Kanban(props: {
  projectId: string;
  cards: Card[];
  loading: boolean;
  selectedCardId: string | null;
  onSelectCard: (id: string | null) => void;
  session: SessionSummary | undefined;
}) {
  const updateCard = useUpdateCard(props.projectId);
  const createCard = useCreateCard(props.projectId);
  const dialog = useDialog();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // small drag threshold so clicks still work
    }),
  );

  const cardsByStatus: Record<Status, Card[]> = {
    pending: props.cards.filter((c) => c.status === 'pending'),
    in_progress: props.cards.filter((c) => c.status === 'in_progress'),
    completed: props.cards.filter((c) => c.status === 'completed'),
  };

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const card = props.cards.find((c) => c.id === e.active.id);
    const target = e.over?.id as Status | undefined;
    if (!card || !target || !STATUSES.includes(target) || card.status === target) return;
    updateCard.mutate({ cardId: card.id, patch: { status: target } });
  }

  async function addCard(status: Status) {
    const title = await dialog.prompt({
      title: `New ${statusLabel[status]} card`,
      label: 'Title',
      placeholder: 'Brief title for this requirement',
      required: true,
      submitLabel: 'Create',
    });
    if (!title || !title.trim()) return;
    try {
      const created = await createCard.mutateAsync({ title: title.trim(), status });
      props.onSelectCard(created.id);
    } catch (e: any) {
      dialog.toast(`创建失败: ${e?.message ?? e}`, 'error');
    }
  }

  const activeCard = activeId ? props.cards.find((c) => c.id === activeId) ?? null : null;

  // Click on empty kanban background closes the detail panel.
  // Ignore clicks that originated on a card or column header (+ button).
  function handleBackgroundClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!props.selectedCardId) return;
    const t = e.target as HTMLElement;
    if (t.closest('.task-card')) return;
    if (t.closest('.column-header')) return;
    props.onSelectCard(null);
  }

  return (
    <>
      <header className="view-header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="view-title">{props.session?.name ?? props.projectId}</h1>
          <p className="view-meta">
            {props.session?.project} · {props.cards.length} cards ·{' '}
            {cardsByStatus.completed.length} done · {cardsByStatus.in_progress.length} doing ·{' '}
            {cardsByStatus.pending.length} todo
          </p>
        </div>
      </header>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="kanban" onClick={handleBackgroundClick}>
          {STATUSES.map((s) => (
            <Column
              key={s}
              status={s}
              cards={cardsByStatus[s]}
              loading={props.loading}
              selectedCardId={props.selectedCardId}
              onSelectCard={props.onSelectCard}
              onAdd={() => addCard(s)}
            />
          ))}
          <div className="kanban-spacer" aria-hidden />
        </div>
        <DragOverlay>
          {activeCard ? <TaskCard card={activeCard} selected={false} dragging onClick={() => {}} /> : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function Column(props: {
  status: Status;
  cards: Card[];
  loading: boolean;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
  onAdd: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: props.status });
  return (
    <div className="column">
      <div className="column-header">
        <span className={`column-dot ${props.status}`}></span>
        <span className={`column-title ${props.status}`}>{statusLabel[props.status]}</span>
        <span className="column-count">{props.cards.length}</span>
        <button className="add-card-btn" onClick={props.onAdd} title="Add card">
          +
        </button>
      </div>
      <div ref={setNodeRef} className={`column-tasks ${isOver ? 'drop-target' : ''}`}>
        {props.cards.length === 0 ? (
          <div className="column-empty">{props.loading ? 'Loading…' : 'No cards'}</div>
        ) : (
          props.cards.map((c) => (
            <DraggableTaskCard
              key={c.id}
              card={c}
              selected={c.id === props.selectedCardId}
              onClick={() => props.onSelectCard(c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableTaskCard(props: { card: Card; selected: boolean; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: props.card.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}>
      <TaskCard card={props.card} selected={props.selected} dragging={isDragging} onClick={props.onClick} />
    </div>
  );
}

function TaskCard(props: { card: Card; selected: boolean; dragging: boolean; onClick: () => void }) {
  const { card } = props;
  const totalSubtasks = card.subtasks.length;
  const doneSubtasks = card.subtasks.filter((s) => s.done).length;
  return (
    <div
      className={`task-card ${card.status} ${props.selected ? 'selected' : ''} ${props.dragging ? 'dragging' : ''}`}
      onClick={props.onClick}
    >
      <div className="task-card-id">
        <span>#{card.id.slice(2, 8)}</span>
        {card.blocked && <span className="badge blocked">Blocked</span>}
      </div>
      <div className="task-card-title">{card.title}</div>
      {card.section && <div className="task-card-section">{card.section}</div>}
      {(totalSubtasks > 0 || card.references.length > 0 || card.findings.length > 0) && (
        <div className="task-card-progress">
          {totalSubtasks > 0 && (
            <span>
              ☑ {doneSubtasks}/{totalSubtasks}
            </span>
          )}
          {card.references.length > 0 && <span>🔗 {card.references.length}</span>}
          {card.findings.length > 0 && <span>💡 {card.findings.length}</span>}
        </div>
      )}
    </div>
  );
}
