// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { AnchorButton, Button, Dialog, DialogBody, DialogFooter, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useEffect, useState } from 'react';
import 'styles/components/FeedbackButton.scss';

const FeedbackButton = () => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isInitialState, setIsInitialState] = useState(true);
    const [isUserInteracting, setIsUserInteracting] = useState(false);

    const handleCloseDialog = () => {
        setIsDialogOpen(false);
    };

    const handleHover = () => {
        setIsUserInteracting(true);
        setIsInitialState(false);
    };

    const handleHoverRemove = () => {
        setIsUserInteracting(false);
    };

    const animationDuration = getFeedbackAnimationDurationMs();

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsInitialState(false);
        }, animationDuration);

        return () => clearTimeout(timer);
    }, [animationDuration]);

    return (
        <>
            <Button
                className={classNames('feedback-button', {
                    'animate-in': isInitialState,
                    'user-is-interacting': isUserInteracting,
                })}
                text='Feedback'
                intent={Intent.PRIMARY}
                endIcon={IconNames.COMMENT}
                onClick={() => setIsDialogOpen(true)}
                onMouseEnter={handleHover}
                onMouseLeave={handleHoverRemove}
                onFocus={handleHover}
                onBlur={handleHoverRemove}
            />

            <Dialog
                title='Improving TT-NN Visualizer'
                icon={IconNames.INFO_SIGN}
                isOpen={isDialogOpen}
                usePortal
                className='bp6-dark'
                onClose={handleCloseDialog}
            >
                <DialogBody>
                    <p>
                        We&apos;re looking for your feedback to improve the TT-NN Visualizer. If you have any
                        suggestions, issues, or feature requests, please let us know by opening an issue in GitHub.
                    </p>
                </DialogBody>

                <DialogFooter
                    actions={
                        <>
                            <Button
                                text='Close'
                                onClick={handleCloseDialog}
                            />
                            <AnchorButton
                                intent={Intent.SUCCESS}
                                icon={IconNames.SHARE}
                                text='Share feedback'
                                href='https://github.com/tenstorrent/ttnn-visualizer/issues'
                                target='_blank'
                                onClick={handleCloseDialog}
                            />
                        </>
                    }
                />
            </Dialog>
        </>
    );
};

const getFeedbackAnimationDurationMs = () => {
    const root = document.documentElement;
    const duration = getComputedStyle(root).getPropertyValue('--feedback-animation-duration').trim();
    const delay = getComputedStyle(root).getPropertyValue('--feedback-animation-delay').trim();

    return parseFloat(duration) * 1000 + parseFloat(delay) * 1000;
};

export default FeedbackButton;
