import { useState } from 'react';
import { Button, Dialog, DialogContent } from '../components/ui';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

/**
 * "Installer l'application", for the account menu and the phone menu.
 * Chrome/Edge/Android: the browser's own install prompt. iPhone/iPad (no such
 * API) and browsers that have not offered it: a dialog with the steps.
 * `available` is false once the admin runs installed.
 */
export function useInstallApp() {
  const { installed, isIos, canPromptNatively, install } = useInstallPrompt();
  const [helpOpen, setHelpOpen] = useState(false);

  const start = () => {
    if (canPromptNatively) void install();
    else setHelpOpen(true);
  };

  const helpDialog = (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent
        size="sm"
        title="Installer l'application"
        description="SBC Admin sur l'écran d'accueil, ouvert en plein écran comme une application."
        footer={<Button variant="primary" onClick={() => setHelpOpen(false)}>Compris</Button>}
      >
        {isIos ? (
          <ol className="list-decimal space-y-2 pl-5 text-sm text-fg">
            <li>Ouvrez cette page dans <strong>Safari</strong>.</li>
            <li>Touchez le bouton <strong>Partager</strong> (le carré avec une flèche vers le haut).</li>
            <li>Choisissez <strong>« Sur l'écran d'accueil »</strong>, puis <strong>Ajouter</strong>.</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-sm text-fg">
            <li>Ouvrez le menu du navigateur (<strong>⋮</strong> en haut à droite dans Chrome).</li>
            <li>Choisissez <strong>« Installer l'application »</strong> ou <strong>« Ajouter à l'écran d'accueil »</strong>.</li>
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );

  return { available: !installed, start, helpDialog };
}
