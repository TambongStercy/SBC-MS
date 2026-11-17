import { useCallback, useRef } from 'react';
import type React from 'react';

/** True when the press started on a button, link or field inside the pressable area. */
const fromControl = (e: React.SyntheticEvent) => {
    const control = (e.target as HTMLElement).closest('button, a, input, textarea, select, [role="menuitem"]');
    return !!control && control !== e.currentTarget;
};

/**
 * Long press (500 ms) on touch and mouse: calls `onLongPress`, otherwise a
 * normal press calls `onClick`. Used to start selecting messages or
 * conversations, like in the member app. Presses on a button inside the area
 * are left to that button.
 */
export function useLongPress(onLongPress: () => void, onClick?: () => void, { delay = 500 }: { delay?: number } = {}) {
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isLongPressRef = useRef(false);
    const movedRef = useRef(false);

    const start = useCallback(() => {
        isLongPressRef.current = false;
        movedRef.current = false;
        timeoutRef.current = setTimeout(() => {
            isLongPressRef.current = true;
            onLongPress();
        }, delay);
    }, [onLongPress, delay]);

    const cancel = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, []);

    const clear = useCallback((shouldTriggerClick = true) => {
        cancel();
        if (shouldTriggerClick && !isLongPressRef.current && !movedRef.current && onClick) onClick();
    }, [cancel, onClick]);

    return {
        onMouseDown: (e: React.MouseEvent) => { if (e.button === 0 && !fromControl(e)) start(); },
        onMouseUp: (e: React.MouseEvent) => { if (e.button === 0 && !fromControl(e)) clear(); },
        onMouseLeave: () => cancel(),
        onTouchStart: (e: React.TouchEvent) => { if (!fromControl(e)) start(); },
        // preventDefault: no emulated mouse events after the touch (they would press twice)
        onTouchEnd: (e: React.TouchEvent) => { if (!fromControl(e)) { e.preventDefault(); clear(); } },
        // a scroll is not a press
        onTouchMove: () => { movedRef.current = true; cancel(); },
        onTouchCancel: cancel,
    };
}
