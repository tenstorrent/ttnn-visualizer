import Overlay from './Overlay';
import ProgressBar from './ProgressBar';
import 'styles/components/FileStatusOverlay.scss';

interface FileStatusOverlayProps {
    isOpen: boolean;
    onClose: () => void;
}

const FILE_DOWNLOAD_STATUS = {
    currentFileName: 'foo.tar.gz',
    numberOfFiles: 12,
    percentOfCurrent: 49,
    finishedFiles: 6,
};

function FileStatusOverlay({ isOpen, onClose }: FileStatusOverlayProps) {
    return (
        <Overlay
            isOpen={isOpen}
            onClose={onClose}
            hideCloseButton
            canEscapeKeyClose={false}
            canOutsideClickClose={false}
        >
            <div className='flex'>
                <p>
                    Downloading <strong>{FILE_DOWNLOAD_STATUS.currentFileName}</strong>
                </p>

                <p>{`File ${FILE_DOWNLOAD_STATUS.numberOfFiles - FILE_DOWNLOAD_STATUS.finishedFiles} of ${FILE_DOWNLOAD_STATUS.numberOfFiles}`}</p>
            </div>

            <ProgressBar
                progress={FILE_DOWNLOAD_STATUS.percentOfCurrent / 100}
                estimated={1}
            />
        </Overlay>
    );
}

export default FileStatusOverlay;
