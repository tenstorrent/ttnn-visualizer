import { ReportFolder } from '../hooks/useRemote';

const isLocalFolderOutdated = (folder: ReportFolder) => {
    if (!folder.lastSynced) {
        return true;
    }

    const lastSynced = new Date(folder.lastSynced);
    const lastModified = new Date(parseInt(folder.lastModified, 10));

    return lastModified > lastSynced;
};

export default isLocalFolderOutdated;
