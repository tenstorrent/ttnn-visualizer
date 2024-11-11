import { useCallback, useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { FileProgress, FileStatus } from '../model/APIData';

interface UseSocketUploadProps {
    socket: Socket;
    onUploadFinished?: ({ directoryName }: { directoryName: string }) => void;
}

const CHUNK_SIZE = 1024 * 64; // 64KB
const UPDATE_INTERVAL = 1000; // 1-second interval for progress updates

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

    const currentFileRef = useRef<{ fileName: string; percentOfCurrent: number }>({
        fileName: '',
        percentOfCurrent: 0,
    });

    const uploadDirectory = useCallback(
        async (files: FileList) => {
            if (files.length === 0) {
                return;
            }
            const topLevelDirectory = files[0].webkitRelativePath.split('/')[0];
            setIsUploading(true);
            setProgress({
                currentFileName: '',
                numberOfFiles: files.length,
                percentOfCurrent: 0,
                finishedFiles: 0,
                status: FileStatus.STARTED,
            });

            let updateTimer: number;

            const processFile = async (file: File): Promise<void> => {
                let offset = 0;
                const fullRelativePath = file.webkitRelativePath;
                currentFileRef.current.fileName = fullRelativePath;

                return new Promise((resolve) => {
                    const readChunk = () => {
                        const reader = new FileReader();
                        const slice = file.slice(offset, offset + CHUNK_SIZE);

                        reader.onload = (event) => {
                            if (event.target?.result) {
                                const isLastChunk = offset + CHUNK_SIZE >= file.size;

                                socket.emit('upload-report', {
                                    directory: topLevelDirectory,
                                    fileName: fullRelativePath,
                                    chunk: event.target.result,
                                    isLastChunk,
                                });

                                offset += CHUNK_SIZE;
                                currentFileRef.current.percentOfCurrent = Math.min((offset / file.size) * 100, 100);

                                if (!isLastChunk) {
                                    // Delay to avoid overwhelming the server
                                    setTimeout(readChunk, 10);
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

            const uploadFilesSequentially = async () => {
                // Set up a timer to update the UI every 1 second
                updateTimer = setInterval(() => {
                    setProgress((prev) => ({
                        ...prev,
                        status: FileStatus.UPLOADING,
                        currentFileName: currentFileRef.current.fileName,
                        percentOfCurrent: currentFileRef.current.percentOfCurrent,
                    }));
                }, UPDATE_INTERVAL);

                for (const file of Array.from(files)) {
                    await processFile(file);
                    setProgress((prev) => ({
                        ...prev,
                        finishedFiles: prev.finishedFiles + 1,
                    }));
                }

                clearInterval(updateTimer); // Stop updates once all files are processed
                setIsUploading(false);

                // Set the final progress status to FINISHED
                setProgress((prev) => ({
                    ...prev,
                    status: FileStatus.FINISHED,
                    percentOfCurrent: 100, // Ensure 100% completion
                }));

                if (onUploadFinished) {
                    onUploadFinished({ directoryName: topLevelDirectory });
                }
            };

            await uploadFilesSequentially(); // Await the uploadFilesSequentially function

            return () => clearInterval(updateTimer); // Ensure cleanup in case of component unmount
        },
        [socket, onUploadFinished],
    );

    useEffect(() => {
        // Cleanup when the component unmounts if uploading
        return () => {
            setIsUploading(false);
        };
    }, []);

    return { isUploading, uploadDirectory, progress };
};

export default useSocketUpload;
