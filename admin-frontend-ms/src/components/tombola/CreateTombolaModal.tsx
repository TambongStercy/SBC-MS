import React, { useState } from 'react';

interface CreateTombolaModalProps {
    isOpen: boolean;
    isLoading: boolean;
    onSave: (month: number, year: number) => Promise<void>; // Async save handler
    onClose: () => void;
}

const CreateTombolaModal: React.FC<CreateTombolaModalProps> = ({
    isOpen,
    isLoading,
    onSave,
    onClose,
}) => {
    const currentYear = new Date().getFullYear();
    const [year, setYear] = useState<number>(currentYear);
    const [month, setMonth] = useState<number>(new Date().getMonth() + 1); // Default to current month (1-12)
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        setError(null); // Clear previous errors
        // Basic validation
        if (month < 1 || month > 12) {
            setError('Le mois doit être compris entre 1 et 12.');
            return;
        }
        // Add year validation if needed (e.g., must be current year or past N years)
        if (year > currentYear) {
            setError('Impossible de créer une tombola pour une année future.');
            return;
        }
        // Consider adding check for future month in current year if needed

        try {
            await onSave(month, year);
            // onClose(); // Let the parent handle closing on success
        } catch (err) {
            // Error is handled by the parent via toast, but we can set local error too
            setError(err instanceof Error ? err.message : 'La tombola n’a pas pu être créée.');
            console.error("Error in modal save:", err);
        }
    };

    if (!isOpen) {
        return null;
    }

    // Create year options (e.g., current year and past 5 years)
    const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

    return (
        <div className="fixed inset-0 bg-black/75 flex justify-center items-center z-50 p-4">
            <div className="bg-surface p-6 rounded-lg w-full max-w-sm border border-line">
                <h2 className="text-xl font-semibold text-fg mb-4">Nouvelle tombola</h2>

                {error && <p className="text-red-600 dark:text-red-400 text-sm mb-3">Erreur : {error}</p>}

                <div className="mb-4">
                    <label htmlFor="month" className="block text-sm font-medium text-fg-muted mb-1">Mois (1-12)</label>
                    <input
                        type="number"
                        id="month"
                        value={month}
                        onChange={(e) => setMonth(parseInt(e.target.value, 10) || 1)}
                        min="1"
                        max="12"
                        className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md text-fg focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500"
                        required
                        disabled={isLoading}
                    />
                </div>

                <div className="mb-6">
                    <label htmlFor="year" className="block text-sm font-medium text-fg-muted mb-1">Année</label>
                    <select
                        id="year"
                        value={year}
                        onChange={(e) => setYear(parseInt(e.target.value, 10))}
                        className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md text-fg focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500"
                        required
                        disabled={isLoading}
                    >
                        {yearOptions.map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="px-4 py-2 bg-surface-3 text-fg text-sm font-medium rounded-md hover:bg-surface-2 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-fg-subtle focus:ring-offset-surface disabled:opacity-50"
                    >
                        Annuler
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isLoading}
                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 focus:ring-offset-surface disabled:opacity-50"
                    >
                        {isLoading ? 'Création…' : 'Créer la tombola'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateTombolaModal; 