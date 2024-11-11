import { useCallback, useState } from 'react';
import { Socket } from 'socket.io-client';
import { FileProgress, FileStatus } from '../model/APIData';

interface UseSocketUploadProps {
    socket: Socket;
    onUploadFinished?: ({ directoryName }: { directoryName: string }) => void;
}

const CHUNK_SIZE = 1024 * 64; // Adjust chunk size as needed

const useSocketUpload = (props: UseSocketUploadProps) => {
    console.info(props.socket?.connected);
    const { socket } = props;
    const onUploadFinished = props?.onUploadFinished;
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState<FileProgress>({
        currentFileName: '',
        numberOfFiles: 0,
        percentOfCurrent: 0,
        finishedFiles: 0,
        status: FileStatus.INACTIVE,
    });

    const uploadDirectory = useCallback(
        (files: FileList) => {
            if (files.length === 0) {
                return;
            }
            socket.emit('ping', { message: 'transferingFiles' });
            const topLevelDirectory = files[0].webkitRelativePath.split('/')[0];
            setIsUploading(true);
            setProgress({
                currentFileName: '',
                numberOfFiles: files.length,
                percentOfCurrent: 0,
                finishedFiles: 0,
                status: FileStatus.STARTED,
            });

            const processFile = (file: File): Promise<void> => {
                let offset = 0;
                const fullRelativePath = file.webkitRelativePath;

                return new Promise((resolve) => {
                    const readChunk = () => {
                        const reader = new FileReader();
                        const slice = file.slice(offset, offset + CHUNK_SIZE);

                        reader.onload = (event) => {
                            if (event.target?.result) {
                                socket.emit('upload-report', {
                                    directory: topLevelDirectory,
                                    fileName: fullRelativePath,
                                    chunk: event.target.result,
                                    isLastChunk: offset + CHUNK_SIZE >= file.size,
                                });

                                offset += CHUNK_SIZE;
                                const percentOfCurrent = Math.min((offset / file.size) * 100, 100);

                                // Update progress state only at specific intervals (e.g., every 10% to minimize rerenders)
                                if (percentOfCurrent - progress.percentOfCurrent >= 10 || percentOfCurrent === 100) {
                                    setProgress((prev) => ({
                                        ...prev,
                                        currentFileName: fullRelativePath,
                                        percentOfCurrent,
                                        status: percentOfCurrent === 100 ? FileStatus.FINISHED : FileStatus.UPLOADING,
                                    }));
                                }

                                if (offset < file.size) {
                                    // readChunk();
                                    setTimeout(readChunk, 500); // Delay before reading the next chunk
                                } else {
                                    resolve(); // Resolve when the entire file is uploaded
                                }
                            }
                        };

                        reader.onerror = (error) => {
                            console.error('Error reading file chunk:', error);
                            setProgress((prev) => ({
                                ...prev,
                                status: FileStatus.FAILED,
                            }));
                            resolve(); // Resolve to continue processing other files even if there is an error
                        };

                        reader.readAsArrayBuffer(slice);
                    };

                    readChunk();
                });
            };

            // eslint-disable-next-line promise/catch-or-return
            Promise.all(Array.from(files).map(processFile)).then(() => {
                setIsUploading(false);
                setProgress((prev: FileProgress) => {
                    return {
                        ...prev,
                        status: FileStatus.FINISHED,
                        finishedFiles: prev.numberOfFiles,
                    };
                });
                // eslint-disable-next-line promise/always-return
                if (onUploadFinished) {
                    onUploadFinished({ directoryName: topLevelDirectory });
                }
            });
        },
        [progress.percentOfCurrent],
    );

    return { isUploading, uploadDirectory, progress };
};

export default useSocketUpload;
