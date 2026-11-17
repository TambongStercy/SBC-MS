import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Attachment01Icon, Download04Icon, File01Icon, Image01Icon, LinkSquare02Icon, LockIcon, Pdf01Icon } from '@hugeicons/core-free-icons';
import { errorMessage } from '../../api/http';
import { ticketsApi } from '../../api/tickets';
import type { Attachment, TicketMessage } from '../../api/types';
import { Badge, Button, Dialog, DialogContent, Skeleton } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format';

const AUTHOR_LABEL: Record<TicketMessage['author']['type'], string> = {
  member: 'Membre',
  agent: 'Agent',
  assistant: 'Assistant',
  system: 'Système',
};

function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${formatNumber(Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

const isImage = (a: Attachment) => a.mimeType?.startsWith('image/');
const isPdf = (a: Attachment) => a.mimeType === 'application/pdf';

/** The conversation, oldest first. Internal notes are drawn apart (tint, dashed border, lock, label). */
export function Conversation({ ticketId, messages }: { ticketId: string; messages: TicketMessage[] }) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  if (!messages.length) return <p className="py-8 text-center text-sm text-fg-muted">Aucun message.</p>;
  return (
    <>
      <ol className="flex flex-col gap-3" aria-label="Conversation">
        {messages.map(m => <MessageItem key={m.id} message={m} onOpenAttachment={setViewing} />)}
      </ol>
      <AttachmentViewer ticketId={ticketId} attachment={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function MessageItem({ message: m, onOpenAttachment }: { message: TicketMessage; onOpenAttachment: (a: Attachment) => void }) {
  const fromMember = m.author.type === 'member';
  const system = m.author.type === 'system';
  if (system && !m.internal) {
    return (
      <li className="flex justify-center">
        <p className="rounded-control bg-surface-2 px-3 py-1.5 text-xs text-fg-muted">
          {m.body} <span className="text-fg-subtle">· {formatRelative(m.createdAt)}</span>
        </p>
      </li>
    );
  }
  return (
    <li className={cn('flex', fromMember ? 'justify-start' : 'justify-end')} data-internal={m.internal ? 'true' : undefined}>
      <article
        className={cn(
          'w-full max-w-[min(100%,42rem)] rounded-panel border px-4 py-3',
          m.internal
            ? 'border-dashed border-warning bg-warning-soft'
            : fromMember
              ? 'border-line bg-surface'
              : 'border-line bg-surface-2',
        )}
        aria-label={m.internal ? `Note interne de ${m.author.name}` : `Message de ${m.author.name}`}
      >
        {m.internal && (
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[color-mix(in_oklch,var(--warning),var(--fg)_35%)]">
            <HugeiconsIcon icon={LockIcon} size={14} aria-hidden="true" />
            Note interne — invisible pour le membre
          </p>
        )}
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-medium text-fg">
            {m.author.name}
            <span className="ml-2 text-xs font-normal text-fg-muted">{AUTHOR_LABEL[m.author.type] ?? m.author.type}</span>
          </p>
          <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)} className="text-xs text-fg-muted">{formatRelative(m.createdAt)}</time>
        </header>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{m.body}</p>
        {m.attachments?.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Pièces jointes">
            {m.attachments.map(a => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onOpenAttachment(a)}
                  className="inline-flex max-w-full items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs text-fg hover:border-line-strong"
                >
                  <HugeiconsIcon icon={isImage(a) ? Image01Icon : isPdf(a) ? Pdf01Icon : File01Icon} size={14} className="shrink-0 text-fg-muted" aria-hidden="true" />
                  <span className="max-w-[12rem] truncate">{a.name}</span>
                  <span className="text-fg-muted">{fileSize(a.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
    </li>
  );
}

/**
 * Opens a private attachment: the presigned URL is asked for only on click
 * (it expires), then shown in place (image, PDF) or offered as a download.
 */
function AttachmentViewer({ ticketId, attachment, onClose }: { ticketId: string; attachment: Attachment | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['tickets', ticketId, 'attachment', attachment?.id],
    queryFn: () => ticketsApi.attachmentUrl(ticketId, attachment!.id),
    enabled: !!attachment,
    staleTime: 0,
    gcTime: 0,
  });
  const url = q.data?.url ?? null;
  const error = q.isError ? errorMessage(q.error, 'Impossible d’ouvrir la pièce jointe.') : '';
  const close = onClose;

  return (
    <Dialog open={!!attachment} onOpenChange={o => { if (!o) close(); }}>
      {attachment && (
        <DialogContent
          size="lg"
          title={attachment.name}
          description={<span className="flex items-center gap-2"><HugeiconsIcon icon={Attachment01Icon} size={14} aria-hidden="true" />{attachment.mimeType} · {fileSize(attachment.size)}</span>}
          footer={url ? (
            <>
              <Button asChild variant="outline">
                <a href={url} target="_blank" rel="noopener noreferrer"><HugeiconsIcon icon={LinkSquare02Icon} size={16} aria-hidden="true" /> Ouvrir dans un onglet</a>
              </Button>
              <Button asChild variant="primary">
                <a href={url} download={attachment.name} rel="noopener noreferrer"><HugeiconsIcon icon={Download04Icon} size={16} aria-hidden="true" /> Télécharger</a>
              </Button>
            </>
          ) : undefined}
        >
          {error ? (
            <p role="alert" className="py-8 text-center text-sm text-danger">{error}</p>
          ) : !url ? (
            <Skeleton className="h-64 w-full" />
          ) : isImage(attachment) ? (
            <img src={url} alt={attachment.name} referrerPolicy="no-referrer" className="mx-auto max-h-[65dvh] w-auto max-w-full rounded-md border border-line object-contain" />
          ) : isPdf(attachment) ? (
            <iframe src={url} title={attachment.name} referrerPolicy="no-referrer" className="h-[65dvh] w-full rounded-md border border-line bg-surface" />
          ) : (
            <div className="py-8 text-center">
              <Badge tone="neutral">Aperçu indisponible pour ce type de fichier</Badge>
              <p className="mt-2 text-sm text-fg-muted">Téléchargez le fichier pour l’ouvrir.</p>
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
