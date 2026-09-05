import { useRef, useState } from 'react';
import { Play, Pause, Maximize2, Gauge } from 'lucide-react';

/**
 * Video player for the verification review queue.
 *
 * Not a port of the app's CustomVideoPlayer: that one is built for a hero video
 * — poster art, a title, controls that fade away after three seconds. Reviewing
 * a screen recording is the opposite job. The admin has to read a six-digit code
 * off one frame and a view count off another, so the controls must stay put and
 * slowing the video down matters more than anything decorative.
 *
 * Hence a speed control, which the native player only exposes through a
 * right-click menu most people never find.
 */
const SPEEDS = [0.5, 1, 1.5, 2];

const clock = (seconds: number): string => {
    if (!Number.isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

export default function ReviewVideoPlayer({ src }: { src: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [speed, setSpeed] = useState(1);
    // Why it failed, not just that it did. A <video> fires the same onError for a
    // codec it cannot decode and for a server that returned 500, and claiming the
    // first when it was the second sends the reviewer hunting for a phone-format
    // problem that does not exist.
    const [failure, setFailure] = useState<string | null>(null);

    const diagnose = async () => {
        try {
            const res = await fetch(src, { method: 'GET', headers: { Range: 'bytes=0-1' } });
            if (!res.ok) {
                setFailure(
                    res.status >= 500
                        ? `Le stockage n'a pas pu renvoyer ce fichier (erreur ${res.status}). Ce n'est pas un problème de format — réessayez plus tard ou prévenez la technique.`
                        : `Fichier introuvable ou inaccessible (erreur ${res.status}).`,
                );
                return;
            }
            setFailure('Le fichier est bien téléchargé mais le navigateur ne sait pas le décoder (format non supporté). Ouvrez-le dans un nouvel onglet.');
        } catch {
            setFailure("Impossible de joindre le serveur de fichiers. Vérifiez la connexion, puis réessayez.");
        }
    };

    const toggle = () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) { void v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
    };

    const cycleSpeed = () => {
        const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
        setSpeed(next);
        if (videoRef.current) videoRef.current.playbackRate = next;
    };

    const seek = (value: number) => {
        setProgress(value);
        if (videoRef.current) videoRef.current.currentTime = value;
    };

    if (failure) {
        return (
            <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-6 text-center text-sm text-gray-400">
                {failure}
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-xl border border-gray-700 bg-black">
            <video
                ref={videoRef}
                src={src}
                playsInline
                preload="metadata"
                onClick={toggle}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
                onEnded={() => setPlaying(false)}
                onError={() => { void diagnose(); }}
                className="w-full cursor-pointer bg-black"
            />

            <div className="flex items-center gap-3 border-t border-gray-700 bg-gray-900 px-3 py-2">
                <button
                    onClick={toggle}
                    aria-label={playing ? 'Pause' : 'Lecture'}
                    className="text-gray-200 hover:text-white"
                >
                    {playing ? <Pause size={18} /> : <Play size={18} />}
                </button>

                <span className="w-20 shrink-0 text-[11px] tabular-nums text-gray-400">
                    {clock(progress)} / {clock(duration)}
                </span>

                <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.05}
                    value={progress}
                    onChange={(e) => seek(Number(e.target.value))}
                    aria-label="Position dans la vidéo"
                    className="h-1 flex-1 cursor-pointer accent-blue-500"
                />

                <button
                    onClick={cycleSpeed}
                    title="Vitesse de lecture"
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
                >
                    <Gauge size={14} /> {speed}×
                </button>

                <button
                    onClick={() => videoRef.current?.requestFullscreen?.()}
                    aria-label="Plein écran"
                    className="text-gray-300 hover:text-white"
                >
                    <Maximize2 size={16} />
                </button>
            </div>
        </div>
    );
}
