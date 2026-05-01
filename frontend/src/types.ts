/** TypeScript types mirroring backend/schema.py (schemaVersion=2). */

export type Status = 'pending' | 'in_progress' | 'completed';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  body: string;
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Reference {
  id: string;
  title: string;
  url: string;
  note: string;
}

export interface Finding {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Card {
  id: string;
  status: Status;
  blocked: boolean;
  title: string;
  body: string;
  section: string;
  tags: string[];
  priority: number | null;
  subtasks: Subtask[];
  references: Reference[];
  findings: Finding[];
  createdAt: string;
  updatedAt: string;
}

export interface ProgressState {
  schemaVersion: number;
  project: string;
  updatedAt: string;
  cards: Card[];
}

export interface SessionSummary {
  id: string;
  name: string | null;
  slug: string | null;
  project: string | null;
  description: string | null;
  gitBranch: string | null;
  taskCount: number;
  completed: number;
  inProgress: number;
  pending: number;
  blocked: number;
  createdAt: string | null;
  modifiedAt: string;
}
