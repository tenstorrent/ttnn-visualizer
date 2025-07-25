// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { AnchorButton, Button, Dialog, DialogBody, DialogFooter, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useState } from 'react';
import 'styles/components/FeedbackButton.scss';

const FeedbackButton = () => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const handleCloseDialog = () => {
        setIsDialogOpen(false);
    };

    return (
        <>
            <Button
                className='feedback-button'
                text='Feedback'
                intent={Intent.PRIMARY}
                endIcon={IconNames.COMMENT}
                onClick={() => setIsDialogOpen(true)}
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
