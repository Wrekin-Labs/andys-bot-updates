"""R7.2 Evidence-Weighted Trading Edge research module.

Research / decision support only. It never submits, amends or cancels orders.
"""
from .engine import (
    Candidate,
    Evidence,
    MarketRegime,
    Decision,
    StrategyLabEvidence,
    R72Config,
    R72EdgeEngine,
)

__all__ = [
    "Candidate", "Evidence", "MarketRegime", "Decision",
    "StrategyLabEvidence", "R72Config", "R72EdgeEngine",
]
