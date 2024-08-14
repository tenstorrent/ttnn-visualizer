import logging
from functools import wraps
from timeit import default_timer

logger = logging.getLogger(__name__)

def str_to_bool(string_value):
    return string_value.lower() in ("yes", "true", "t", "1")


def timer(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        start_time = default_timer()
        response = f(*args, **kwargs)
        total_elapsed_time = default_timer() - start_time
        logger.info(f"Elapsed time: {total_elapsed_time}")
        return response

    return wrapper
