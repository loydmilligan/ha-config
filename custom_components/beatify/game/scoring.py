"""
Scoring calculation for Beatify.

MVP scoring (Epic 4) - accuracy-based scoring only.
Advanced scoring (Epic 5) adds speed bonus, streaks, and betting.
"""

from __future__ import annotations

from custom_components.beatify.const import (
    DIFFICULTY_DEFAULT,
    DIFFICULTY_SCORING,
    STREAK_MILESTONES,
)

# Points awarded
POINTS_EXACT = 10
POINTS_WRONG = 0

# Artist scoring constants (Story 10.1)
POINTS_ARTIST_EXACT = 10
POINTS_ARTIST_PARTIAL = 5


def calculate_accuracy_score(
    guess: int,
    actual: int,
    difficulty: str = DIFFICULTY_DEFAULT,
) -> int:
    """
    Calculate accuracy points based on guess vs actual year.

    Scoring rules vary by difficulty (Story 14.1):
    - Easy: exact=10, ±7 years=5, ±10 years=1
    - Normal: exact=10, ±3 years=5, ±5 years=1
    - Hard: exact=10, ±2 years=3, else=0

    Args:
        guess: Player's guessed year
        actual: Correct year from playlist
        difficulty: Difficulty level (easy/normal/hard)

    Returns:
        Points earned based on accuracy and difficulty

    """
    diff = abs(guess - actual)

    # Get config for current difficulty, fallback to default if unknown
    scoring = DIFFICULTY_SCORING.get(difficulty, DIFFICULTY_SCORING[DIFFICULTY_DEFAULT])
    close_range = scoring["close_range"]
    close_points = scoring["close_points"]
    near_range = scoring["near_range"]
    near_points = scoring["near_points"]

    if diff == 0:
        return POINTS_EXACT
    if close_range > 0 and diff <= close_range:
        return close_points
    if near_range > 0 and diff <= near_range:
        return near_points
    return POINTS_WRONG


def calculate_speed_multiplier(elapsed_time: float, round_duration: float) -> float:
    """
    Calculate speed bonus multiplier based on submission timing.

    Formula: speed_multiplier = 2.0 - (1.0 * submission_time_ratio)
    - Instant submission (0s): 2.0x multiplier (double points!)
    - At deadline (30s): 1.0x multiplier (no bonus)

    Args:
        elapsed_time: Seconds elapsed since round started when player submitted
        round_duration: Total round duration in seconds (default 30)

    Returns:
        Multiplier between 1.0 and 2.0

    """
    if round_duration <= 0:
        return 1.0

    # Calculate ratio (0.0 = instant, 1.0 = at deadline)
    submission_time_ratio = elapsed_time / round_duration

    # Clamp to valid range [0.0, 1.0]
    submission_time_ratio = max(0.0, min(1.0, submission_time_ratio))

    # Formula: 2.0x at instant, 1.0x at deadline (linear)
    return 2.0 - (1.0 * submission_time_ratio)


def calculate_round_score(
    guess: int,
    actual: int,
    elapsed_time: float,
    round_duration: float,
    difficulty: str = DIFFICULTY_DEFAULT,
) -> tuple[int, int, float]:
    """
    Calculate total round score with speed bonus.

    Args:
        guess: Player's guessed year
        actual: Correct year from playlist
        elapsed_time: Seconds elapsed since round started
        round_duration: Total round duration in seconds
        difficulty: Difficulty level (easy/normal/hard)

    Returns:
        Tuple of (final_score, base_score, speed_multiplier)

    """
    base_score = calculate_accuracy_score(guess, actual, difficulty)
    speed_multiplier = calculate_speed_multiplier(elapsed_time, round_duration)
    final_score = int(base_score * speed_multiplier)
    return final_score, base_score, speed_multiplier


def apply_bet_multiplier(
    round_score: int,
    bet: bool,  # noqa: FBT001
) -> tuple[int, str | None]:
    """
    Apply bet multiplier to round score (Story 5.3).

    Betting is double-or-nothing:
    - If bet and scored points (>0): double the score, outcome="won"
    - If bet and 0 points: score stays 0, outcome="lost"
    - If no bet: score unchanged, outcome=None

    Args:
        round_score: Points earned before bet (accuracy x speed)
        bet: Whether player placed a bet

    Returns:
        Tuple of (final_score, bet_outcome)
        bet_outcome is "won", "lost", or None

    """
    if not bet:
        return round_score, None

    if round_score > 0:
        return round_score * 2, "won"
    return 0, "lost"


def calculate_streak_bonus(streak: int) -> int:
    """
    Calculate milestone bonus for streak.

    Bonuses awarded at exact milestones only (Story 5.2):
    - 3 consecutive: +20 points
    - 5 consecutive: +50 points
    - 10 consecutive: +100 points

    Args:
        streak: Current streak count (after incrementing for this round)

    Returns:
        Bonus points (0 if not at milestone)

    """
    return STREAK_MILESTONES.get(streak, 0)


def calculate_years_off_text(diff: int) -> str:
    """
    Get human-readable text for years difference.

    Args:
        diff: Absolute difference between guess and actual

    Returns:
        Text like "Exact!", "2 years off", etc.

    """
    if diff == 0:
        return "Exact!"
    if diff == 1:
        return "1 year off"
    return f"{diff} years off"


def calculate_artist_score(guess: str | None, actual: str) -> tuple[int, str | None]:
    """
    Calculate artist guess score (Story 10.1).

    Matching rules (case-insensitive, whitespace-trimmed):
    - Exact match: 10 points
    - Partial match (substring): 5 points
    - No match: 0 points

    Args:
        guess: Player's guessed artist name (can be None or empty)
        actual: Correct artist name from song metadata

    Returns:
        Tuple of (points, match_type)
        match_type is "exact", "partial", or None

    """
    if not guess or not guess.strip():
        return 0, None

    guess_clean = guess.strip().lower()
    actual_clean = actual.strip().lower()

    # Exact match (case-insensitive)
    if guess_clean == actual_clean:
        return POINTS_ARTIST_EXACT, "exact"

    # Partial match (substring in either direction)
    if guess_clean in actual_clean or actual_clean in guess_clean:
        return POINTS_ARTIST_PARTIAL, "partial"

    return 0, None
