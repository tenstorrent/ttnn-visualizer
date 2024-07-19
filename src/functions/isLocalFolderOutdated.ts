import { ReportFolder } from '../model/Connection';

const isLocalFolderOutdated = (folder: ReportFolder) => {
    if (!folder.lastSynced) {
        return true;
    }

    const lastSynced = new Date(folder.lastSynced);
    const lastModified = new Date(folder.lastModified);

    return lastModified > lastSynced;
};

export default isLocalFolderOutdated;
