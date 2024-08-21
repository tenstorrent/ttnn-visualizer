import { Button, Classes, Intent, Overlay2 } from '@blueprintjs/core';
import classNames from 'classnames';
import { ReactNode } from 'react';
import 'styles/components/Overlay.scss';

interface OverlayProps {
    isOpen: boolean;
    onClose: () => void;
    children: ReactNode;
}

function Overlay({ isOpen, onClose, children }: OverlayProps) {
    return (
        <Overlay2
            isOpen={isOpen}
            onClose={onClose}
            className={Classes.OVERLAY_SCROLL_CONTAINER}
        >
            <div className={classNames('overlay-contents', Classes.DARK, Classes.CARD, Classes.ELEVATION_4)}>
                {children}

                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <Button
                        intent={Intent.DANGER}
                        onClick={onClose}
                    >
                        Close
                    </Button>
                </div>
            </div>
        </Overlay2>
    );
}

export default Overlay;
