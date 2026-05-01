import { useEffect } from 'react';
import type { SessionSummary } from '../types';
import { useAddProject, useRemoveProject } from '../api';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useTheme } from '../hooks/useTheme';
import { useDialog } from './Dialog';

export function Sidebar(props: {
  sessions: SessionSummary[];
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useLocalStorage<boolean>('sidebarCollapsed', false);
  const [theme, setTheme] = useTheme();
  const addProject = useAddProject();
  const removeProject = useRemoveProject();
  const dialog = useDialog();

  async function handleAddProject() {
    const path = await dialog.prompt({
      title: '添加项目到清单',
      message: '该路径必须存在且已有 .claude-progress/ 目录;没有的话先在该仓库跑 /progress-tracker init。',
      label: '项目绝对路径',
      placeholder: '/Users/you/code/my-repo',
      required: true,
      submitLabel: 'Add',
    });
    if (!path?.trim()) return;
    try {
      await addProject.mutateAsync({ path: path.trim() });
      dialog.toast('已添加', 'success');
    } catch (e: any) {
      dialog.toast(`添加失败: ${e?.message ?? e}`, 'error');
    }
  }

  async function handleRemoveProject(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    const ok = await dialog.confirm({
      title: '从清单移除',
      message: `确定移除 "${name}"?\n仅从侧栏隐藏,不会删除项目下的 .claude-progress/。`,
      danger: true,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await removeProject.mutateAsync(id);
      dialog.toast(`已移除 "${name}"`, 'info');
    } catch (err: any) {
      dialog.toast(`移除失败: ${err?.message ?? err}`, 'error');
    }
  }

  // Ctrl/Cmd + \ to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setCollapsed((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setCollapsed]);

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <header className="sidebar-header">
        <div className="sidebar-header-row">
          <div className="logo">
            <div className="logo-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="logo-text">Progress Cockpit</span>
          </div>
          <div className="sidebar-actions">
            <button
              className="sidebar-toggle theme-toggle"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? (
                /* Sun (will switch to light) */
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
              ) : (
                /* Moon (will switch to dark) */
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <button
              className="sidebar-toggle"
              onClick={() => setCollapsed((v) => !v)}
              title="Toggle sidebar (Ctrl+\)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <div className="sidebar-body">
        <div className="sidebar-section-label">
          Projects
          <button
            className="add-card-btn"
            style={{ marginLeft: 'auto' }}
            onClick={handleAddProject}
            title="Add project to registry"
          >
            +
          </button>
        </div>
        {props.loading ? (
          <div className="nested-empty">Loading…</div>
        ) : props.sessions.length === 0 ? (
          <div className="nested-empty">
            （清单为空;点 + 添加项目路径,或在子目录跑 `/progress-tracker init` 后再加）
          </div>
        ) : (
          props.sessions.map((s) => (
            <div
              key={s.id}
              className={`project-item ${s.id === props.activeId ? 'active' : ''}`}
              onClick={() => props.onSelect(s.id)}
            >
              <div className="project-item-row">
                <div className="project-item-name">{s.name ?? s.id}</div>
                <button
                  className="project-item-remove"
                  onClick={(e) => handleRemoveProject(e, s.id, s.name ?? s.id)}
                  title="Remove from registry"
                >
                  ×
                </button>
              </div>
              <div className="project-item-meta">
                <span className="badge todo">{s.taskCount} cards</span>
                {s.completed > 0 && <span className="badge done">{s.completed} done</span>}
                {s.inProgress > 0 && <span className="badge doing">{s.inProgress} doing</span>}
                {s.blocked > 0 && <span className="badge blocked">{s.blocked} blocked</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
