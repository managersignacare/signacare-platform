import { useMemo } from 'react';
import { Box } from '@mui/material';
import DOMPurify from 'dompurify';
import { markdownToHtml } from '../../utils/markdownToHtml';

interface MarkdownRendererProps {
  content: string;
  sx?: Record<string, unknown>;
}

/**
 * Renders markdown content as formatted HTML.
 * Converts **bold**, *italic*, headings, lists into proper HTML.
 * Sanitised with DOMPurify to prevent XSS from AI-generated or user content.
 */
export function MarkdownRenderer({ content, sx }: MarkdownRendererProps) {
  const html = useMemo(() => DOMPurify.sanitize(markdownToHtml(content)), [content]);
  return (
    <Box
      dangerouslySetInnerHTML={{ __html: html }}
      sx={{
        fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
        fontSize: 13,
        lineHeight: 1.7,
        color: '#3D484B',
        '& h1': { fontSize: 18, fontWeight: 700, color: '#3D484B', borderBottom: '2px solid #327C8D', pb: 0.5, mt: 2, mb: 1 },
        '& h2': { fontSize: 15, fontWeight: 700, color: '#327C8D', mt: 2, mb: 0.5 },
        '& h3': { fontSize: 14, fontWeight: 600, color: '#3D484B', mt: 1.5, mb: 0.5 },
        '& h4': { fontSize: 13, fontWeight: 600, color: '#555', mt: 1, mb: 0.5 },
        '& strong': { color: '#3D484B', fontWeight: 600 },
        '& em': { fontStyle: 'italic' },
        '& ul': { pl: 2.5, my: 0.5 },
        '& ol': { pl: 2.5, my: 0.5 },
        '& li': { mb: 0.25, fontSize: 13 },
        '& hr': { border: 'none', borderTop: '1px solid #ddd', my: 1.5 },
        '& p': { my: 0.5 },
        '& table': { width: '100%', borderCollapse: 'collapse', my: 1, fontSize: 12 },
        '& th': { textAlign: 'left', fontWeight: 600, color: '#3D484B', borderBottom: '2px solid #327C8D', py: 0.5, px: 1, fontSize: 11, whiteSpace: 'nowrap' },
        '& td': { borderBottom: '1px solid #eee', py: 0.5, px: 1, fontSize: 12 },
        '& tr:hover td': { bgcolor: '#f9f9f9' },
        '& tbody tr:last-child td': { borderBottom: 'none' },
        ...sx,
      }}
    />
  );
}
