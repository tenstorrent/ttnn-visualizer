class RemoteFolderException(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.message = message
        self.status = status


class RemoteSqliteException(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.message = message
        self.status = status


class NoProjectsException(RemoteFolderException):
    pass

class DatabaseFileNotFoundException(Exception):
    pass