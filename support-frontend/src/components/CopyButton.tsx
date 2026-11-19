import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { copyText } from '../lib/download';
import { Button, type ButtonProps } from './ui';
import { toast } from './toast';

/** Copies `text`; the label turns into "Copié" for a moment. */
export function CopyButton({ text, label = 'Copier', size = 'sm', variant = 'outline', className }: {
  text: string;
  label?: string;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button type="button" size={size} variant={variant} className={className}
      onClick={async () => {
        if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1500); }
        else toast.error('Copie refusée par le navigateur : sélectionnez le texte et copiez-le.');
      }}>
      <HugeiconsIcon icon={done ? Tick02Icon : Copy01Icon} size={14} aria-hidden="true" />
      {done ? 'Copié' : label}
    </Button>
  );
}
