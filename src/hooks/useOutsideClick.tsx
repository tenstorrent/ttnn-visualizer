// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { RefObject, useEffect } from 'react';

const useOutsideClick = (refs: RefObject<HTMLElement>[], handler?: (event: MouseEvent) => void) => {
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (handler) {
                const clickedOutside = refs.every((ref) => ref.current && !ref.current.contains(event.target as Node));
                if (clickedOutside) {
                    handler(event);
                }
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
    }, [refs, handler]);
};

export default useOutsideClick;
