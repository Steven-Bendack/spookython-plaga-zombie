"""AWS Lambda worker: simulates one chunk (one policy, a range of runs).

Called directly by the API Lambda (interactive tournament) and by each item of
the Step Functions Distributed Map (big Monte Carlo jobs). Same pure function
the local process pool uses.
"""
from engine.montecarlo import run_chunk


def handler(event, _context):
    return run_chunk(event)
