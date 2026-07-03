"""
Risk manager: enforces all protective rules before each trade.

Behaviour (new model):
  • "normal"  — all metrics are healthy, full position size.
  • "warning" — daily loss OR consecutive losses limit hit; position size is
                halved automatically, bot CONTINUES trading with a log warning.
  • "halted"  — balance has dropped by hard_stop_pct% of the session starting
                balance OR balance is insufficient; bot STOPS trading.

This means max_daily_loss_pct and max_consecutive_losses are now soft limits
(they reduce risk but never stop the bot), while hard_stop_pct is the only
hard kill-switch.
"""
import logging
import random
import threading
from datetime import date
from typing import Optional, Literal

logger = logging.getLogger(__name__)

RiskLevel = Literal["normal", "warning", "halted"]


class RiskManager:
    def __init__(
        self,
        starting_balance: float,
        investment_amount: float,
        max_daily_loss_pct: float = 5.0,
        max_consecutive_losses: int = 5,
        min_win_rate: float = 0.55,
        use_compound_interest: bool = False,
        compound_factor: float = 1.0,
        min_win_rate_for_compound: float = 0.55,
        investment_mode: str = "fixed",
        investment_pct: float = 5.0,
        hard_stop_pct: float = 75.0,
    ):
        self.starting_balance          = starting_balance
        self.investment_amount         = investment_amount
        self.investment_mode           = investment_mode   # "fixed" | "percent"
        self.investment_pct            = investment_pct    # % of balance when mode="percent"
        self.max_daily_loss_pct        = max_daily_loss_pct
        self.max_consecutive_losses    = max_consecutive_losses
        self.min_win_rate              = min_win_rate
        self.use_compound_interest     = use_compound_interest
        self.compound_factor           = max(0.0, min(compound_factor, 3.0))
        self.min_win_rate_for_compound = min_win_rate_for_compound
        self.hard_stop_pct             = max(10.0, min(hard_stop_pct, 99.0))

        self._lock           = threading.Lock()
        self._daily_profit   = 0.0
        self._cons_losses    = 0
        self._total_trades   = 0
        self._total_wins     = 0
        self._current_date   = date.today()
        self._warning_reasons: list[str] = []

    # ── Reset daily stats at midnight ────────────────────────────────────────

    def _check_date_rollover(self) -> None:
        today = date.today()
        if today != self._current_date:
            self._daily_profit = 0.0
            self._current_date = today
            logger.info("Daily stats reset for %s", today)

    # ── Public API ────────────────────────────────────────────────────────────

    @property
    def risk_level(self) -> RiskLevel:
        """Current risk level, independent of the trade check."""
        with self._lock:
            return self._compute_risk_level(self.starting_balance)

    def _compute_risk_level(self, current_balance: float) -> RiskLevel:
        """Called inside lock. Returns the current risk level."""
        # Hard stop: too much total balance lost
        hard_floor = self.starting_balance * (1.0 - self.hard_stop_pct / 100.0)
        if current_balance <= hard_floor:
            return "halted"
        if self.investment_amount > 0 and current_balance < self.investment_amount:
            return "halted"

        # Soft warnings
        max_loss = self.starting_balance * self.max_daily_loss_pct / 100.0
        if self._daily_profit <= -max_loss:
            return "warning"
        if self._cons_losses >= self.max_consecutive_losses:
            return "warning"
        if self._total_trades >= 20:
            wr = self._total_wins / self._total_trades
            if wr < self.min_win_rate:
                return "warning"

        return "normal"

    def can_trade(self, current_balance: float,
                  win_rate: Optional[float] = None) -> tuple[bool, str]:
        """
        Returns (allowed, reason).
        • "halted"  → returns (False, reason)  — bot must stop
        • "warning" → returns (True, reason)   — bot continues with reduced size
        • "normal"  → returns (True, "OK")
        """
        with self._lock:
            self._check_date_rollover()
            self._warning_reasons = []

            # Hard stop: balance below critical floor
            hard_floor = self.starting_balance * (1.0 - self.hard_stop_pct / 100.0)
            if current_balance <= hard_floor:
                return False, (
                    f"Hard stop: balance ${current_balance:.2f} has dropped by "
                    f"{self.hard_stop_pct:.0f}% of starting balance ${self.starting_balance:.2f}"
                )

            # Hard stop: literally can't afford a trade
            min_trade = self.investment_amount if self.investment_mode == "fixed" else 0.01
            if current_balance < min_trade:
                return False, "Insufficient balance for minimum trade size"

            # --- Soft limits (collect warnings, don't block) ---
            max_loss = self.starting_balance * self.max_daily_loss_pct / 100.0
            if self._daily_profit <= -max_loss:
                self._warning_reasons.append(
                    f"Daily loss limit reached (${abs(self._daily_profit):.2f} / ${max_loss:.2f})"
                )

            if self._cons_losses >= self.max_consecutive_losses:
                self._warning_reasons.append(
                    f"Consecutive losses: {self._cons_losses} / {self.max_consecutive_losses}"
                )

            if self._total_trades >= 20 and win_rate is not None and win_rate < self.min_win_rate:
                self._warning_reasons.append(
                    f"Win rate {win_rate:.1%} below minimum {self.min_win_rate:.1%}"
                )

            if self._warning_reasons:
                return True, "WARNING: " + " | ".join(self._warning_reasons)

            return True, "OK"

    def get_risk_reduction_factor(self, current_balance: float) -> float:
        """
        Returns the fraction of normal position size to use:
          • 1.0  — normal
          • 0.5  — in warning state (any soft limit hit)
          • 0.25 — approaching hard stop (< 2× the floor)
        """
        with self._lock:
            hard_floor = self.starting_balance * (1.0 - self.hard_stop_pct / 100.0)
            distance = current_balance - hard_floor
            total_range = self.starting_balance - hard_floor

            # Very close to hard stop → 25% size
            if total_range > 0 and distance / total_range < 0.15:
                return 0.25

            level = self._compute_risk_level(current_balance)
            if level == "warning":
                return 0.5
            return 1.0

    def reset_consecutive_losses(self) -> None:
        """Reset only the consecutive-loss counter."""
        with self._lock:
            self._cons_losses = 0
            logger.info("Consecutive losses reset by user.")

    def resume_all(self) -> None:
        """Reset ALL soft counters so the bot can trade at full size again."""
        with self._lock:
            self._cons_losses   = 0
            self._daily_profit  = 0.0
            self._total_trades  = 0
            self._total_wins    = 0
            logger.info("Full risk resume: all blocks cleared by user.")

    def update_live_params(
        self,
        investment_amount: Optional[float] = None,
        investment_mode: Optional[str] = None,
        investment_pct: Optional[float] = None,
        use_compound_interest: Optional[bool] = None,
        compound_factor: Optional[float] = None,
        min_win_rate_for_compound: Optional[float] = None,
        hard_stop_pct: Optional[float] = None,
    ) -> None:
        """Hot-update position-sizing params without stopping the bot."""
        with self._lock:
            if investment_amount is not None:
                self.investment_amount = max(0.01, investment_amount)
            if investment_mode is not None:
                self.investment_mode = investment_mode
            if investment_pct is not None:
                self.investment_pct = max(0.1, min(investment_pct, 50.0))
            if use_compound_interest is not None:
                self.use_compound_interest = use_compound_interest
            if compound_factor is not None:
                self.compound_factor = max(0.0, min(compound_factor, 3.0))
            if min_win_rate_for_compound is not None:
                self.min_win_rate_for_compound = min_win_rate_for_compound
            if hard_stop_pct is not None:
                self.hard_stop_pct = max(10.0, min(hard_stop_pct, 99.0))

    def get_position_size(self, balance: float, confidence: float) -> float:
        """
        Position sizing with three layers:
          1. Base amount from mode (fixed / percent).
          2. Compound interest scaling (optional).
          3. Risk-reduction factor (0.5× when in warning, 0.25× near hard stop).
          4. Confidence bonus (+0-20%).
          5. Safety ceiling: never > 25% of balance.
        """
        with self._lock:
            conf_bonus = min(1.2, 1.0 + max(0.0, confidence - 0.55) * 2.0)

            if self.investment_mode == "percent":
                base = max(0.01, balance * self.investment_pct / 100.0)
            else:
                base = self.investment_amount

            # Compound interest scaling
            if self.use_compound_interest and self.starting_balance > 0:
                session_wr = self._total_wins / self._total_trades if self._total_trades > 0 else 0.0
                if session_wr >= self.min_win_rate_for_compound or self._total_trades < 5:
                    growth_ratio = max(0.1, balance / self.starting_balance)
                    compound_scale = max(0.5, growth_ratio ** self.compound_factor)
                    base = base * compound_scale

            amount = base * conf_bonus

        # Apply risk reduction OUTSIDE inner lock to avoid deadlock with get_risk_reduction_factor
        reduction = self.get_risk_reduction_factor(balance)
        amount *= reduction

        # Safety ceiling: never risk more than 25% of balance on a single trade
        amount = min(amount, balance * 0.25)

        # Human-like jitter: real traders never stake the exact same cents twice in a
        # row for a given confidence/balance — a perfectly deterministic amount is a
        # bot fingerprint. ±3% keeps sizing intent intact while breaking the pattern.
        amount *= random.uniform(0.97, 1.03)

        return round(max(amount, 0.01), 2)

    def record_result(self, profit: float, won: bool) -> None:
        with self._lock:
            self._check_date_rollover()
            self._daily_profit += profit
            self._total_trades += 1
            if won:
                self._total_wins  += 1
                self._cons_losses  = 0
            else:
                self._cons_losses += 1

    # ── Stats ─────────────────────────────────────────────────────────────────

    @property
    def daily_profit(self) -> float:
        return self._daily_profit

    @property
    def consecutive_losses(self) -> int:
        return self._cons_losses

    @property
    def overall_win_rate(self) -> float:
        if self._total_trades == 0:
            return 0.0
        return self._total_wins / self._total_trades

    def summary(self) -> dict:
        hard_floor = self.starting_balance * (1.0 - self.hard_stop_pct / 100.0)
        return {
            "daily_profit":       round(self._daily_profit, 2),
            "consecutive_losses": self._cons_losses,
            "total_trades":       self._total_trades,
            "total_wins":         self._total_wins,
            "overall_win_rate":   round(self.overall_win_rate, 4),
            "max_daily_loss":     round(self.starting_balance * self.max_daily_loss_pct / 100, 2),
            "hard_stop_floor":    round(hard_floor, 2),
            "risk_level":         self._compute_risk_level(self.starting_balance),
            "warning_reasons":    list(self._warning_reasons),
        }
