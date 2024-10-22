import enum


class ConnectionTestStates(enum.Enum):
    IDLE = 0
    PROGRESS = 1
    FAILED = 2
    OK = 3
