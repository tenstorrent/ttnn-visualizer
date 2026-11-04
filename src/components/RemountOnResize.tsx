// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Fragment, HTMLAttributes, ReactNode } from 'react';
import useObservedWidth from '../hooks/useObservedWidth';

interface RemountOnResizeProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
}

/**
 * A div that remounts its children whenever its own width changes.
 *
 * Blueprint 6.21's sliders measure their track only on mount and when `min`, `max` or `vertical` change, so a
 * slider mounted while hidden, or whose container later resizes, converts pointer positions with a stale width.
 * Wrapping the slider in this keeps the width state here, so a resize re-renders only this wrapper rather than
 * the page that holds it.
 */
const RemountOnResize = ({ children, ...divProps }: RemountOnResizeProps) => {
    const [ref, width] = useObservedWidth();

    return (
        <div
            {...divProps}
            ref={ref}
        >
            <Fragment key={width}>{children}</Fragment>
        </div>
    );
};

export default RemountOnResize;
