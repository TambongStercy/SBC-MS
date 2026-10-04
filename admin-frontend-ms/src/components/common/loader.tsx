import { Loader2 } from 'lucide-react';

/** Loading state for the older pages: a spinner and a word, not a splash screen. */
function Loader({ name }: { name?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400" role="status">
      <Loader2 className="animate-spin" size={18} />
      <span>{name ? `Chargement : ${name}` : 'Chargement…'}</span>
    </div>
  );
}

export default Loader;
