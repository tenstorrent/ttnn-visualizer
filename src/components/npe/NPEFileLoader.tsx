import React, { useState } from 'react';
import { useSetAtom } from 'jotai';
import useLocalConnection from '../../hooks/useLocal';
import { ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { activeNpeAtom } from '../../store/app';
import createToastNotification from '../../functions/createToastNotification';

interface NPEFileLoaderProps {
    onFileLoad: (data: unknown) => void;
}

const NPEFileLoader: React.FC<NPEFileLoaderProps> = ({ onFileLoad }) => {
    const [, setFileName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { uploadNpeFile } = useLocalConnection();
    const setActiveNpe = useSetAtom(activeNpeAtom);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        setError(null);

        if (!event.target.files) {
            return;
        }

        const file = event.target.files?.[0];
        const response = await uploadNpeFile(event.target.files);

        if (response.status !== 200) {
            // connectionStatus = connectionFailedStatus;
        } else if (response?.data?.status !== ConnectionTestStates.OK) {
            // connectionStatus = directoryErrorStatus;
        } else {
            const fileName = file.name;
            console.log('fileName', fileName);
            setActiveNpe(fileName);
            createToastNotification('Active NPE', fileName);
        }

        // setFileName(file.name);
        // const reader = new FileReader();

        // reader.onload = (e) => {
        //     try {
        //         const result = e.target?.result as string;
        //         const parsedData = JSON.parse(result);
        //         setError(null);
        //         onFileLoad(parsedData);
        //     } catch (err) {
        //         setError('Invalid JSON file. Please upload a valid JSON.');
        //     }
        // };

        // reader.onerror = () => setError('Error reading file.');
        // reader.readAsText(file);
    };

    return (
        <div style={{ maxWidth: 'auto', margin: '0', padding: 0 }}>
            <input
                type='file'
                id='file-upload'
                accept='.json'
                onChange={handleFileChange}
                style={{
                    display: 'block',
                    padding: '0',
                    borderRadius: '4px',
                    width: '100%',
                    cursor: 'pointer',
                }}
            />
            {error && <p style={{ color: 'red', marginTop: 10 }}>{error}</p>}
        </div>
    );
};

export default NPEFileLoader;
