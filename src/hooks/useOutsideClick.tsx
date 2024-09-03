// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useEffect } from 'react';

const useOutsideClick = (elements: HTMLElement[], handler?: (event: MouseEvent) => void) => {
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (handler) {
                const clickedOutside = elements.every((el) => el && !el.contains(event.target as Node));

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
    }, [elements, handler]);
};

export default useOutsideClick;
