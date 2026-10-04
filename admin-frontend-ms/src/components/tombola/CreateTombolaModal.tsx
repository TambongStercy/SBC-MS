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
            setError('Month must be between 1 and 12.');
            return;
        }
        // Add year validation if needed (e.g., must be current year or past N years)
        if (year > currentYear) {
            setError('Cannot create a tombola for a future year.');
            return;
        }
        // Consider adding check for future month in current year if needed

        try {
            await onSave(month, year);
            // onClose(); // Let the parent handle closing on success
        } catch (err) {
            // Error is handled by the parent via toast, but we can set local error too
            setError(err instanceof Error ? err.message : 'Failed to create tombola');
            console.error("Error in modal save:", err);
        }
    };

    if (!isOpen) {
        return null;
    }

    // Create year options (e.g., current year and past 5 years)
    const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-sm">
                <h2 className="text-xl font-semibold text-white mb-4">Create New Tombola</h2>

                {error && <p className="text-red-400 text-sm mb-3">Error: {error}</p>}

                <div className="mb-4">
                    <label htmlFor="month" className="block text-sm font-medium text-gray-300 mb-1">Month (1-12)</label>
                    <input
                        type="number"
                        id="month"
                        value={month}
                        onChange={(e) => setMonth(parseInt(e.target.value, 10) || 1)}
                        min="1"
                        max="12"
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        required
                        disabled={isLoading}
                    />
                </div>

                <div className="mb-6">
                    <label htmlFor="year" className="block text-sm font-medium text-gray-300 mb-1">Year</label>
                    <select
                        id="year"
                        value={year}
                        onChange={(e) => setYear(parseInt(e.target.value, 10))}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
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
                        className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 focus:ring-offset-gray-800 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isLoading}
                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 focus:ring-offset-gray-800 disabled:opacity-50"
                    >
                        {isLoading ? 'Creating...' : 'Create Tombola'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateTombolaModal; 