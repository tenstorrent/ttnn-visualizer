// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import 'styles/components/LoadingSpinner.scss';
import { LoadingSpinnerSizes } from '../definitions/LoadingSpinner';

interface LoadingSpinnerProps {
    size?: LoadingSpinnerSizes;
}

function LoadingSpinner({ size }: LoadingSpinnerProps) {
    return (
        <div
            className={classNames('loading-spinner', {
                small: size === LoadingSpinnerSizes.SMALL,
            })}
        >
            <div />
            <div />
            <div />
            <div />
        </div>
    );
}

export default LoadingSpinner;
