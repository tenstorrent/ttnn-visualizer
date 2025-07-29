// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { AnchorButton, Button, Dialog, DialogBody, DialogFooter, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useEffect, useRef, useState } from 'react';
import 'styles/components/FeedbackButton.scss';

const ANIMATION_DURATION = 3800; // Should match animation duration + animation delay of feedback-slide in FeedbackButton.scss

const FeedbackButton = () => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);

    const handleCloseDialog = () => {
        setIsDialogOpen(false);
    };

    const handleHover = () => {
        if (buttonRef.current) {
            buttonRef.current.classList.add('hover-state');
            buttonRef.current.classList.remove('animate-in');
        }
    };

    const handleHoverRemove = () => {
        if (buttonRef.current) {
            buttonRef.current.classList.remove('hover-state');
        }
    };

    useEffect(() => {
        buttonRef.current?.classList.add('animate-in');

        const timer = setTimeout(() => {
            buttonRef.current?.classList.remove('initial-state', 'animate-in');
        }, ANIMATION_DURATION);

        return () => clearTimeout(timer);
    }, []);

    return (
        <>
            <Button
                ref={buttonRef}
                className='feedback-button initial-state'
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
                icon='info-sign'
                isOpen={isDialogOpen}
                usePortal={false}
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

export default FeedbackButton;
