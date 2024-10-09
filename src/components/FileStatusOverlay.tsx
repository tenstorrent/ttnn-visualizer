import Overlay from './Overlay';
import ProgressBar from './ProgressBar';
import 'styles/components/FileStatusOverlay.scss';

interface FileStatusOverlayProps {
    isOpen: boolean;
    onClose?: () => void;
    fileStatus: {
        currentFileName: string;
        numberOfFiles: number;
        percentOfCurrent: number;
        finishedFiles: number;
        estimatedDuration?: number;
    };
    canEscapeKeyClose?: boolean;
}

function FileStatusOverlay({ isOpen, onClose, fileStatus, canEscapeKeyClose = false }: FileStatusOverlayProps) {
    return (
        <Overlay
            isOpen={isOpen}
            onClose={onClose}
            hideCloseButton
            canEscapeKeyClose={canEscapeKeyClose}
            canOutsideClickClose={false}
        >
            <div className='flex'>
                <p>
                    Downloading <strong>{fileStatus.currentFileName}</strong>
                </p>

                <p>{`File ${fileStatus.numberOfFiles - fileStatus.finishedFiles} of ${fileStatus.numberOfFiles}`}</p>
            </div>

            <ProgressBar
                progress={fileStatus.percentOfCurrent / 100}
                estimated={fileStatus?.estimatedDuration}
            />
        </Overlay>
    );
}

export default FileStatusOverlay;
