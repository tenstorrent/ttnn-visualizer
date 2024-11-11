import { useCallback, useState } from 'react';
import { Socket } from 'socket.io-client';
import { FileProgress, FileStatus } from '../model/APIData';

interface UseSocketUploadProps {
    socket: Socket;
    onUploadFinished?: ({ directoryName }: { directoryName: string }) => void;
}

const CHUNK_SIZE = 1024 * 128; // Adjust chunk size as needed

const useSocketUpload = (props: UseSocketUploadProps) => {
    const { socket, onUploadFinished } = props;
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
            socket.emit('ping', { message: 'transferringFiles' });
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
                const fullRelativePath = file.webkitRelativePath; // Keep subdirectory structure

                return new Promise((resolve) => {
                    const readChunk = () => {
                        const reader = new FileReader();
                        const slice = file.slice(offset, offset + CHUNK_SIZE);

                        reader.onload = (event) => {
                            if (event.target?.result) {
                                socket.emit('upload-report', {
                                    directory: topLevelDirectory,
                                    fileName: fullRelativePath, // Include full relative path
                                    chunk: event.target.result,
                                    isLastChunk: offset + CHUNK_SIZE >= file.size,
                                });

                                offset += CHUNK_SIZE;
                                const percentOfCurrent = Math.min((offset / file.size) * 100, 100);
                                console.info(percentOfCurrent);
                                // Update progress state only at specific intervals (e.g., every 10% to minimize rerenders)
                                setProgress((prev) => {
                                    if (
                                        percentOfCurrent - prev.percentOfCurrent >= 2 ||
                                        percentOfCurrent === 100 ||
                                        prev.currentFileName !== fullRelativePath
                                    ) {
                                        return {
                                            ...prev,
                                            currentFileName: fullRelativePath,
                                            percentOfCurrent,
                                            status: FileStatus.UPLOADING,
                                        };
                                    }
                                    return prev; // Return the previous state if no update is necessary
                                });

                                if (offset < file.size) {
                                    setTimeout(() => readChunk(), 10); // Delay before reading the next chunk
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
                            resolve(); // Continue processing other files even if there's an error
                        };

                        reader.readAsArrayBuffer(slice);
                    };

                    readChunk();
                });
            };

            // Process all files, then handle completion
            Promise.all(Array.from(files).map(processFile)).then(() => {
                setIsUploading(false);
                setProgress((prev) => ({
                    ...prev,
                    status: FileStatus.FINISHED,
                    finishedFiles: prev.numberOfFiles,
                }));
                if (onUploadFinished) {
                    onUploadFinished({ directoryName: topLevelDirectory });
                }
            });
        },
        [socket, onUploadFinished],
    );

    return { isUploading, uploadDirectory, progress };
};

export default useSocketUpload;
