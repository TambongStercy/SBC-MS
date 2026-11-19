/** "Réinitialiser mon mot de passe" → "reinitialiser-mon-mot-de-passe". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Plain-text preview of a Markdown body: paragraphs split on blank lines,
 * line breaks kept. Rendered as text, never as HTML.
 */
export function TextPreview({ body }: { body: string }) {
  const paragraphs = body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (!paragraphs.length) return <p className="text-sm text-fg-subtle">Rien à afficher.</p>;
  return (
    <div className="space-y-3 text-sm leading-relaxed text-fg">
      {paragraphs.map((p, i) => <p key={i} className="whitespace-pre-wrap break-words">{p}</p>)}
    </div>
  );
}
