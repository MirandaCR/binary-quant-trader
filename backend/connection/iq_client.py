"""
IQ Option connection wrapper.
Official API: https://github.com/iqoptionapi/iqoptionapi
"""
import logging
import threading
import time
from typing import Optional, Tuple, List, Dict

logger = logging.getLogger(__name__)


class IQClient:
    def __init__(self, email: str, password: str, account_type: str = "PRACTICE"):
        self.email        = email
        self.password     = password
        self.account_type = account_type.upper()
        self._iq          = None
        self._lock        = threading.Lock()
        self._connected   = False

    # ── Connection ────────────────────────────────────────────────────────────

    def connect(self) -> Tuple[bool, str]:
        try:
            from iqoptionapi.stable_api import IQ_Option
            logger.info("Connecting to IQ Option — email=%s  account=%s",
                        self.email, self.account_type)
            self._iq = IQ_Option(self.email, self.password)
            check, reason = self._iq.connect()
            logger.info("connect() → check=%s  reason=%s", check, reason)

            if check:
                self._iq.change_balance(self.account_type)
                self._connected = True
                balance = self.get_balance()
                logger.info("Connected! Balance=%.2f [%s]", balance, self.account_type)
                return True, "OK"

            reason_str = str(reason) if reason else "Unknown error"
            if "invalid_credentials" in reason_str:
                return False, "Wrong email or password"
            if "2FA" in reason_str:
                return False, "2FA is enabled — please disable it in IQ Option settings"
            if "Name or service not known" in reason_str:
                return False, "No internet connection"
            return False, reason_str

        except ImportError:
            return False, "iqoptionapi not installed"
        except Exception as exc:
            logger.exception("Connect error: %s", exc)
            return False, f"Connection error: {exc}"

    def disconnect(self) -> None:
        try:
            if self._iq:
                self._iq.close()
        except Exception:
            pass
        self._connected = False

    def check_connect(self) -> bool:
        try:
            return bool(self._iq and self._iq.check_connect())
        except Exception:
            return False

    def ensure_connected(self) -> bool:
        if not self.check_connect():
            ok, _ = self.connect()
            return ok
        return True

    # ── Account ───────────────────────────────────────────────────────────────

    def get_balance(self) -> float:
        try:
            return float(self._iq.get_balance()) if self._iq else 0.0
        except Exception:
            return 0.0

    def get_server_timestamp(self) -> float:
        try:
            return float(self._iq.get_server_timestamp()) if self._iq else time.time()
        except Exception:
            return time.time()

    # ── Candles ───────────────────────────────────────────────────────────────

    def get_candles(self, asset: str, timeframe: int,
                    count: int, end_time: Optional[float] = None) -> List[Dict]:
        with self._lock:
            if not self.ensure_connected():
                return []
            if end_time is None:
                end_time = time.time()
            try:
                candles = self._iq.get_candles(asset, timeframe, count, end_time)
                return candles if candles else []
            except Exception as exc:
                logger.error("get_candles(%s) error: %s", asset, exc)
                return []

    # ── Assets ────────────────────────────────────────────────────────────────

    def get_payout(self, asset: str) -> float:
        """Standard IQ Option binary payout. Hardcoded to avoid get_all_open_time() bug."""
        return 0.80

    def is_asset_open(self, asset: str) -> bool:
        """
        Check if an asset is currently tradeable by fetching 2 candles.
        Returns True only when actual candle data is returned.
        """
        try:
            candles = self.get_candles(asset, 60, 2)
            return bool(candles and len(candles) > 0)
        except Exception:
            return False

    def get_available_assets(self, assets: List[str], timeframe: int = 60) -> List[str]:
        """
        Filter the given asset list to only those that return candle data (i.e., are
        currently open and tradeable on IQ Option). Dead / closed assets are removed.
        """
        available: List[str] = []
        for asset in assets:
            try:
                candles = self.get_candles(asset, timeframe, 3)
                if candles and len(candles) >= 1:
                    available.append(asset)
                    logger.debug("Asset %s → OK", asset)
                else:
                    logger.warning("Asset %s → no candle data (skipped)", asset)
            except Exception as exc:
                logger.warning("Asset %s probe failed: %s (skipped)", asset, exc)
        return available

    # ── Trading ───────────────────────────────────────────────────────────────

    def buy(self, amount: float, asset: str,
            direction: str, expiration_minutes: int,
            expiration_seconds: Optional[int] = None) -> Tuple[bool, Optional[int]]:
        """
        Place a binary/turbo option. If expiration_seconds is set (e.g. 30), use direct
        expiration: server_time + expiration_seconds for exact result after N seconds.
        Otherwise use expiration_minutes (candle-based).
        """
        with self._lock:
            if not self.ensure_connected():
                return False, None
            try:
                if expiration_seconds is not None and expiration_seconds > 0:
                    server_ts = self.get_server_timestamp()
                    expired_ts = int(server_ts) + int(expiration_seconds)
                    option_type = "turbo" if expiration_seconds <= 120 else "binary"
                    status, order_id = self._iq.buy_by_raw_expirations(
                        amount, asset, direction, option_type, expired_ts
                    )
                else:
                    status, order_id = self._iq.buy(amount, asset, direction, expiration_minutes)
                if status:
                    logger.info("BUY OK  %s %s $%.2f  id=%s",
                                direction.upper(), asset, amount, order_id)
                else:
                    logger.error("BUY FAILED  %s %s", direction.upper(), asset)
                return bool(status), order_id
            except Exception as exc:
                logger.error("buy() error: %s", exc)
                return False, None

    def check_win(self, order_id: int,
                  amount: float = 1.0,
                  expiration_minutes: int = 1,
                  expiration_seconds: Optional[int] = None) -> Optional[float]:
        """
        Check trade result with a hard timeout.

        IQ Option check_win_v3 returns a TUPLE (win, profit):
          - win: str 'win' | 'loose' | 'equal' (or bool)
          - profit: net P&L in account currency (positive for win, negative for loss).

        Returns:
            positive float → WIN  (actual profit e.g. +0.80)
            negative float → LOSS (net loss e.g. -1.0)
            None           → not yet settled / timeout
        """
        timeout = (expiration_seconds + 25) if expiration_seconds else (expiration_minutes * 60 + 90)

        result_box = [None]
        done_event = threading.Event()

        def _task():
            try:
                r = self._iq.check_win_v3(int(order_id))
                result_box[0] = r
            except Exception as exc:
                logger.warning("check_win_v3 error for %s: %s", order_id, exc)
            finally:
                done_event.set()

        t = threading.Thread(target=_task, daemon=True, name=f"chk-{order_id}")
        t.start()
        finished = done_event.wait(timeout=timeout)

        if not finished:
            logger.warning("check_win TIMEOUT for order %s after %ds", order_id, timeout)
            return None  # will be retried on next loop

        raw = result_box[0]
        if raw is None:
            return None  # not settled yet

        # API returns (win_key, profit_amount): win_key is 'win'|'loose'|'equal' or bool
        if isinstance(raw, (list, tuple)) and len(raw) >= 2:
            win_key, profit_val = raw[0], raw[1]
            try:
                profit_float = float(profit_val)
            except (TypeError, ValueError):
                # If profit not a number, infer from win_key
                if win_key in ("win", True, "true"):
                    payout = self.get_payout("") / 100.0 if self.get_payout("") > 1 else self.get_payout("")
                    profit_float = amount * payout
                else:
                    profit_float = -float(amount)
            else:
                # API may return profit in different units; ensure sign matches win/loss
                if win_key in ("loose", "loss", False, "false"):
                    profit_float = -abs(amount) if profit_float >= 0 else profit_float
                elif win_key in ("win", True, "true") and profit_float < 0:
                    payout = self.get_payout("") / 100.0 if self.get_payout("") > 1 else self.get_payout("")
                    profit_float = amount * payout
            return profit_float

        # Legacy: single number (positive = win profit, zero/negative = loss)
        try:
            raw = float(raw)
        except (TypeError, ValueError):
            return None
        if raw > 0:
            return raw  # WIN: actual profit amount
        return -float(amount)  # LOSS
