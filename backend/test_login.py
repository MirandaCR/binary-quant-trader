"""
Quick credential test — run this BEFORE starting the bot to verify your
IQ Option login works:

    cd backend
    venv\Scripts\python test_login.py
"""
import sys
import time

def check_dependencies():
    print("Checking dependencies…")
    try:
        import websocket
        ver = getattr(websocket, "__version__", "?")
        if ver == "0.56.0":
            print(f"  ✓ websocket-client {ver} (correct)")
        else:
            print(f"  ✗ websocket-client {ver} — WRONG VERSION (need 0.56)")
            print("    Fix: pip install websocket-client==0.56")
            return False
    except ImportError:
        print("  ✗ websocket-client not installed")
        print("    Fix: pip install websocket-client==0.56")
        return False

    try:
        import websockets
        print(f"  ✓ websockets {websockets.__version__} (for FastAPI)")
    except ImportError:
        pass

    # Warn about conflicting 'websocket' package (no dash, no -client)
    try:
        import importlib.metadata
        try:
            importlib.metadata.version("websocket")
            print("  ✗ 'websocket' package found — this CONFLICTS with websocket-client!")
            print("    Fix: pip uninstall websocket")
            return False
        except importlib.metadata.PackageNotFoundError:
            print("  ✓ No conflicting 'websocket' package found")
    except Exception:
        pass

    print()
    return True


def test_login(email: str, password: str):
    print(f"\n{'='*50}")
    print(f"  IQ Option Login Test")
    print(f"{'='*50}")
    print(f"  Email   : {email}")
    print(f"  Password: {'*' * len(password)}")
    print(f"{'='*50}\n")

    try:
        from iqoptionapi.stable_api import IQ_Option
    except ImportError:
        print("ERROR: iqoptionapi not installed. Run: pip install -r requirements.txt")
        sys.exit(1)

    print("Connecting to IQ Option...")
    iq = IQ_Option(email, password)
    status, reason = iq.connect()

    if status:
        balance = iq.get_balance()
        print(f"\n✓ Connected successfully!")
        print(f"  Balance : ${balance:.2f}")
        print(f"\nYour credentials are CORRECT. You can start the bot.\n")
        iq.close()
        return True

    # Handle 2FA
    if reason == "2FA":
        print("\n⚠  Two-Factor Authentication (2FA) is enabled on your account.")
        print("   A code was sent to your phone/email.\n")
        code = input("   Enter your 2FA code: ").strip()
        status2, reason2 = iq.connect_2fa(code)
        if status2:
            balance = iq.get_balance()
            print(f"\n✓ Connected with 2FA!")
            print(f"  Balance : ${balance:.2f}")
            print(f"\nYour credentials are CORRECT. 2FA is enabled — the bot will")
            print(f"need the 2FA code each time it starts.\n")
            iq.close()
            return True
        else:
            print(f"\n✗ 2FA failed: {reason2}\n")
            return False

    # Invalid credentials
    print(f"\n✗ Login failed!")
    print(f"  Reason  : {reason}")
    if "invalid_credentials" in str(reason):
        print("\n  → Your email or password is wrong.")
        print("    Check them at https://iqoption.com")
    elif "No Network" in str(reason) or "service not known" in str(reason):
        print("\n  → No internet connection. Check your network.")
    else:
        print(f"\n  → Unexpected error: {reason}")
    print()
    return False


if __name__ == "__main__":
    if not check_dependencies():
        sys.exit(1)

    # Read from settings.py defaults if no args given
    try:
        from config.settings import BotConfig
        cfg = BotConfig()
        email    = cfg.email
        password = cfg.password
    except Exception:
        email    = input("Email   : ").strip()
        password = input("Password: ").strip()

    if len(sys.argv) == 3:
        email, password = sys.argv[1], sys.argv[2]

    test_login(email, password)
