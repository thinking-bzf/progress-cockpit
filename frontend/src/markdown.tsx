import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { resolveRefUrl } from './api';

export function Markdown({
  source,
  projectId,
}: {
  source: string;
  projectId?: string | null;
}) {
  if (!source?.trim()) return null;
  // Rewrite relative <a href> so they route to the project-file endpoint.
  const components = projectId
    ? {
        a: ({ href, children, ...rest }: any) => (
          <a
            {...rest}
            href={resolveRefUrl(String(href ?? ''), projectId)}
            target="_blank"
            rel="noopener"
          >
            {children}
          </a>
        ),
      }
    : undefined;
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
