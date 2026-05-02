import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Markdown } from '../markdown';

// ============ Types ============

export interface PromptOpts {
  title?: string;
  message?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
}

export interface ConfirmOpts {
  title?: string;
  message?: string;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface FormField {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  type?: 'text' | 'url';
  hint?: string;
}

export interface FormOpts {
  title: string;
  message?: string;
  fields: FormField[];
  submitLabel?: string;
  cancelLabel?: string;
}

export interface PreviewOpts {
  title?: string;
  url: string;       // pre-resolved URL the modal will load
  filename?: string; // original path/filename — used to detect markdown
  externalHref?: string;  // optional "open in new tab" target
  /** How to render. Default 'fetch' — text/markdown body. 'image' embeds via <img>. */
  kind?: 'fetch' | 'image';
}

export type ToastKind = 'info' | 'success' | 'error';

interface DialogAPI {
  prompt(opts: PromptOpts): Promise<string | null>;
  confirm(opts: ConfirmOpts): Promise<boolean>;
  form<T extends Record<string, string>>(opts: FormOpts): Promise<T | null>;
  preview(opts: PreviewOpts): void;
  toast(message: string, kind?: ToastKind): void;
}

type DialogState =
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'form'; opts: FormOpts; resolve: (v: Record<string, string> | null) => void }
  | { kind: 'preview'; opts: PreviewOpts }
  | null;

interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
}

// ============ Context ============

const DialogCtx = createContext<DialogAPI | null>(null);

export function useDialog(): DialogAPI {
  const ctx = useContext(DialogCtx);
  if (!ctx) throw new Error('DialogProvider not mounted');
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const api = useMemo<DialogAPI>(
    () => ({
      prompt: (opts) =>
        new Promise<string | null>((resolve) => {
          setState({ kind: 'prompt', opts, resolve });
        }),
      confirm: (opts) =>
        new Promise<boolean>((resolve) => {
          setState({ kind: 'confirm', opts, resolve });
        }),
      form: <T extends Record<string, string>>(opts: FormOpts) =>
        new Promise<T | null>((resolve) => {
          setState({
            kind: 'form',
            opts,
            resolve: (v) => resolve(v as T | null),
          });
        }),
      preview: (opts) => {
        setState({ kind: 'preview', opts });
      },
      toast: (message, kind = 'info') => {
        const id = Math.random().toString(36).slice(2, 10);
        setToasts((prev) => [...prev, { id, message, kind }]);
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 3500);
      },
    }),
    [],
  );

  const close = useCallback(() => setState(null), []);

  return (
    <DialogCtx.Provider value={api}>
      {children}
      {state && <DialogModal state={state} onClose={close} />}
      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </DialogCtx.Provider>
  );
}

// ============ Modal ============

function DialogModal({ state, onClose }: { state: NonNullable<DialogState>; onClose: () => void }) {
  // Close on ESC
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        cancel();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cancel() {
    if (state.kind === 'prompt') state.resolve(null);
    else if (state.kind === 'confirm') state.resolve(false);
    else if (state.kind === 'form') state.resolve(null);
    onClose();
  }

  const isPreview = state.kind === 'preview';

  return (
    <div className="modal-overlay" onClick={cancel}>
      <div
        className={`modal ${isPreview ? 'modal-preview' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {state.kind === 'prompt' && (
          <PromptBody opts={state.opts} resolve={state.resolve} onClose={onClose} />
        )}
        {state.kind === 'confirm' && (
          <ConfirmBody opts={state.opts} resolve={state.resolve} onClose={onClose} />
        )}
        {state.kind === 'form' && (
          <FormBody opts={state.opts} resolve={state.resolve} onClose={onClose} />
        )}
        {state.kind === 'preview' && <PreviewBody opts={state.opts} onClose={onClose} />}
      </div>
    </div>
  );
}

function PromptBody({
  opts,
  resolve,
  onClose,
}: {
  opts: PromptOpts;
  resolve: (v: string | null) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(opts.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select?.();
  }, []);

  function submit() {
    if (opts.required && !value.trim()) {
      inputRef.current?.focus();
      return;
    }
    resolve(value);
    onClose();
  }
  function cancel() {
    resolve(null);
    onClose();
  }

  return (
    <>
      {opts.title && <h3 className="modal-title">{opts.title}</h3>}
      {opts.message && <div className="modal-message">{opts.message}</div>}
      <div className="modal-body">
        {opts.label && <label className="modal-label">{opts.label}</label>}
        {opts.multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            className="form-textarea"
            rows={opts.rows ?? 6}
            value={value}
            placeholder={opts.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            className="form-input"
            value={value}
            placeholder={opts.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        )}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={cancel}>
          {opts.cancelLabel ?? 'Cancel'}
        </button>
        <button className="btn primary" onClick={submit}>
          {opts.submitLabel ?? 'OK'}
        </button>
      </div>
    </>
  );
}

function ConfirmBody({
  opts,
  resolve,
  onClose,
}: {
  opts: ConfirmOpts;
  resolve: (v: boolean) => void;
  onClose: () => void;
}) {
  const okBtn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    okBtn.current?.focus();
  }, []);
  function ok() {
    resolve(true);
    onClose();
  }
  function cancel() {
    resolve(false);
    onClose();
  }
  return (
    <>
      {opts.title && <h3 className="modal-title">{opts.title}</h3>}
      {opts.message && <div className="modal-message">{opts.message}</div>}
      <div className="modal-actions">
        <button className="btn" onClick={cancel}>
          {opts.cancelLabel ?? 'Cancel'}
        </button>
        <button
          ref={okBtn}
          className={`btn ${opts.danger ? 'danger-solid' : 'primary'}`}
          onClick={ok}
        >
          {opts.confirmLabel ?? (opts.danger ? 'Delete' : 'OK')}
        </button>
      </div>
    </>
  );
}

function FormBody({
  opts,
  resolve,
  onClose,
}: {
  opts: FormOpts;
  resolve: (v: Record<string, string> | null) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(opts.fields.map((f) => [f.name, f.defaultValue ?? ''])),
  );
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  function setField(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }
  function submit() {
    for (const f of opts.fields) {
      if (f.required && !values[f.name]?.trim()) {
        const el = document.querySelector<HTMLInputElement>(`[data-field="${f.name}"]`);
        el?.focus();
        return;
      }
    }
    resolve(values);
    onClose();
  }
  function cancel() {
    resolve(null);
    onClose();
  }

  return (
    <>
      <h3 className="modal-title">{opts.title}</h3>
      {opts.message && <div className="modal-message">{opts.message}</div>}
      <div className="modal-body">
        {opts.fields.map((f, idx) => (
          <div key={f.name} className="form-row">
            <label>
              {f.label}
              {f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
            </label>
            {f.multiline ? (
              <textarea
                ref={idx === 0 ? (firstRef as React.RefObject<HTMLTextAreaElement>) : undefined}
                data-field={f.name}
                className="form-textarea"
                rows={f.rows ?? 6}
                value={values[f.name]}
                placeholder={f.placeholder}
                onChange={(e) => setField(f.name, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            ) : (
              <input
                ref={idx === 0 ? (firstRef as React.RefObject<HTMLInputElement>) : undefined}
                data-field={f.name}
                type={f.type === 'url' ? 'url' : 'text'}
                className="form-input"
                value={values[f.name]}
                placeholder={f.placeholder}
                onChange={(e) => setField(f.name, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            )}
            {f.hint && <div className="form-hint">{f.hint}</div>}
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={cancel}>
          {opts.cancelLabel ?? 'Cancel'}
        </button>
        <button className="btn primary" onClick={submit}>
          {opts.submitLabel ?? 'OK'}
        </button>
      </div>
    </>
  );
}

// ============ Preview ============

function isMarkdownPath(p: string | undefined): boolean {
  if (!p) return false;
  const lower = p.toLowerCase().split('?')[0].split('#')[0];
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function PreviewBody({ opts, onClose }: { opts: PreviewOpts; onClose: () => void }) {
  const kind = opts.kind ?? 'fetch';
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMd = isMarkdownPath(opts.filename ?? opts.url);

  useEffect(() => {
    if (kind !== 'fetch') return;
    let cancelled = false;
    setContent(null);
    setError(null);
    fetch(opts.url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [opts.url, kind]);

  return (
    <>
      <div className="preview-header">
        <div className="preview-title">
          <span className="preview-title-text">{opts.title || opts.filename || 'Preview'}</span>
          {opts.filename && opts.filename !== opts.title && (
            <span className="preview-filename">{opts.filename}</span>
          )}
        </div>
        <div className="preview-actions">
          <a
            className="btn"
            href={opts.externalHref ?? opts.url}
            target="_blank"
            rel="noopener"
            title="Open in new tab"
          >
            ↗ Open
          </a>
          <button className="btn" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>
      </div>
      <div className={`preview-body ${kind === 'image' ? 'is-embed' : ''}`}>
        {kind === 'image' ? (
          <img className="preview-image" src={opts.url} alt={opts.title ?? ''} />
        ) : error ? (
          <div className="preview-error">Failed to load: {error}</div>
        ) : content == null ? (
          <div className="preview-loading">Loading…</div>
        ) : isMd ? (
          <Markdown source={content} />
        ) : (
          <pre className="preview-raw">{content}</pre>
        )}
      </div>
    </>
  );
}

// ============ Toasts ============

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon">
            {t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i'}
          </span>
          <span className="toast-message">{t.message}</span>
          <button className="toast-close" onClick={() => onDismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
