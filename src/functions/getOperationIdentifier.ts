import { Operation } from '../model/APIData';

const getOperationIdentifier = (operation: Operation) =>
    `${operation.id} ${operation.name} ${operation.operationFileIdentifier}`;

export default getOperationIdentifier;
