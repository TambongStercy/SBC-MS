import { useState, useCallback } from 'react';
import { ToastType } from '../components/common/Toast';
import { ToastMessage } from '../components/common/ToastContainer';

export const useToast = () => {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const addToast = useCallback((message: string, type: ToastType) => {
        const id = Date.now().toString() + Math.random().toString(36);
        setToasts((prev) => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    const showSuccess = useCallback((message: string) => {
        addToast(message, 'success');
    }, [addToast]);

    const showError = useCallback((message: string) => {
        addToast(message, 'error');
    }, [addToast]);

    const showWarning = useCallback((message: string) => {
        addToast(message, 'warning');
    }, [addToast]);

    const showInfo = useCallback((message: string) => {
        addToast(message, 'info');
    }, [addToast]);

    return {
        toasts,
        removeToast,
        showSuccess,
        showError,
        showWarning,
        showInfo,
    };
};
