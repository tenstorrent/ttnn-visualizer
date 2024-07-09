import React, { useEffect } from 'react';

const useOutsideClick = (ref: React.RefObject<HTMLElement>, handler?: (event: MouseEvent) => void) => {
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node) && handler) {
                handler(event);
            }
        };
        if (handler !== undefined) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            if (handler !== undefined) {
                document.removeEventListener('mousedown', handleClickOutside);
            }
        };
    }, [ref, handler]);
};

export default useOutsideClick;
