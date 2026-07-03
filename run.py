"""
Run both backend and frontend with a single command:
    python run.py

Requires:
  - Python 3.10+ (for backend)
  - Node.js 18+  (for frontend)
  - Git           (iqoptionapi is installed from GitHub)

On first run it will:
  1. Create backend/venv and install pip packages
  2. Run  npm install  in frontend/
Then start both servers and stream their logs to the console.

Press Ctrl+C to stop everything.
"""

import os
import sys
import subprocess
import threading
import time
import shutil

ROOT    = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(ROOT, "backend")
FRONTEND = os.path.join(ROOT, "frontend")

# ── Colors (works on Windows 10+ with ANSI support) ──────────────────────────
RESET  = "\033[0m"
CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
BOLD   = "\033[1m"
DIM    = "\033[2m"

def banner():
    os.system("cls" if os.name == "nt" else "clear")
    print(f"{BOLD}{CYAN}")
    print("  ╔══════════════════════════════════════╗")
    print("  ║       BINARY OPTIONS BOT             ║")
    print("  ║  Backend  →  http://localhost:8100   ║")
    print("  ║  Frontend →  http://localhost:3010   ║")
    print("  ╚══════════════════════════════════════╝")
    print(RESET)

def log(prefix: str, color: str, line: str):
    print(f"{DIM}│{RESET} {color}{BOLD}[{prefix}]{RESET} {line}", flush=True)

def stream(proc: subprocess.Popen, prefix: str, color: str):
    """Read stdout/stderr and print with a prefix label."""
    for raw in iter(proc.stdout.readline, b""):
        try:
            line = raw.decode("utf-8", errors="replace").rstrip()
        except Exception:
            continue
        if line:
            log(prefix, color, line)

# ── Setup helpers ─────────────────────────────────────────────────────────────

def get_python():
    venv_python = os.path.join(BACKEND, "venv", "Scripts", "python.exe")  # Windows
    if not os.path.exists(venv_python):
        venv_python = os.path.join(BACKEND, "venv", "bin", "python")       # Unix
    return venv_python

def get_pip():
    venv_pip = os.path.join(BACKEND, "venv", "Scripts", "pip.exe")
    if not os.path.exists(venv_pip):
        venv_pip = os.path.join(BACKEND, "venv", "bin", "pip")
    return venv_pip

def setup_backend():
    venv_python = get_python()
    if not os.path.exists(venv_python):
        print(f"{YELLOW}[SETUP] Creating Python virtual environment…{RESET}")
        subprocess.run([sys.executable, "-m", "venv", "venv"], cwd=BACKEND, check=True)

    print(f"{YELLOW}[SETUP] Upgrading pip…{RESET}")
    subprocess.run(
        [get_python(), "-m", "pip", "install", "--upgrade", "pip"],
        cwd=BACKEND, check=True,
    )

    # Remove conflicting websocket packages (iqoptionapi needs websocket-client==0.56)
    print(f"{YELLOW}[SETUP] Fixing websocket dependencies…{RESET}")
    subprocess.run([get_pip(), "uninstall", "-y", "websocket"], cwd=BACKEND, check=False)
    subprocess.run(
        [get_pip(), "install", "--prefer-binary", "websocket-client==0.56"],
        cwd=BACKEND, check=True,
    )

    print(f"{YELLOW}[SETUP] Installing backend dependencies…{RESET}")
    subprocess.run(
        [get_pip(), "install", "--prefer-binary", "-r", "requirements.txt"],
        cwd=BACKEND, check=True,
    )

    # Force correct websocket-client version after all deps installed
    subprocess.run(
        [get_pip(), "install", "--force-reinstall", "--prefer-binary",
         "websocket-client==0.56"],
        cwd=BACKEND, check=True,
    )
    print(f"{GREEN}[SETUP] Backend ready.{RESET}\n")

def setup_frontend():
    nm = os.path.join(FRONTEND, "node_modules")
    if not os.path.exists(nm):
        print(f"{YELLOW}[SETUP] Running npm install…{RESET}")
        npm = shutil.which("npm")
        if not npm:
            print(f"{RED}[ERROR] npm not found. Install Node.js 18+ from https://nodejs.org{RESET}")
            sys.exit(1)
        subprocess.run([npm, "install"], cwd=FRONTEND, check=True)
        print(f"{GREEN}[SETUP] Frontend ready.{RESET}\n")

# ── Process launchers ─────────────────────────────────────────────────────────

def start_backend() -> subprocess.Popen:
    python = get_python()
    proc = subprocess.Popen(
        [python, "main.py"],
        cwd=BACKEND,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
    )
    t = threading.Thread(target=stream, args=(proc, "BACKEND", GREEN), daemon=True)
    t.start()
    return proc

def start_frontend() -> subprocess.Popen:
    npm = shutil.which("npm")
    if not npm:
        print(f"{RED}[ERROR] npm not found.{RESET}")
        sys.exit(1)
    proc = subprocess.Popen(
        [npm, "run", "dev", "--", "--port", "3010"],
        cwd=FRONTEND,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
        shell=False,
    )
    t = threading.Thread(target=stream, args=(proc, "FRONTEND", CYAN), daemon=True)
    t.start()
    return proc

# ── Main ──────────────────────────────────────────────────────────────────────

def kill_port(port: int) -> None:
    """Kill any process listening on the given port (Windows + Unix)."""
    try:
        if os.name == "nt":
            # Windows: find PID via netstat, then kill it
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.split()
                    pid = parts[-1]
                    try:
                        subprocess.run(["taskkill", "/F", "/PID", pid],
                                       capture_output=True, timeout=5)
                        print(f"{YELLOW}[CLEANUP] Killed stale process on port {port} (PID {pid}){RESET}")
                    except Exception:
                        pass
        else:
            subprocess.run(["fuser", "-k", f"{port}/tcp"],
                           capture_output=True, timeout=5)
    except Exception:
        pass


def main():
    # Enable ANSI on Windows
    if os.name == "nt":
        os.system("color")

    banner()

    # ── Kill stale processes on our ports ────────────────────────────────────
    print(f"{YELLOW}[CLEANUP] Freeing ports 8000, 8100 and 3010…{RESET}")
    kill_port(8000)   # old port — kill any strays
    kill_port(8100)   # new port
    kill_port(3010)
    time.sleep(1)

    # ── Install dependencies if needed ───────────────────────────────────────
    try:
        setup_backend()
        setup_frontend()
    except subprocess.CalledProcessError as e:
        print(f"{RED}[ERROR] Setup failed: {e}{RESET}")
        sys.exit(1)

    # ── Start servers ────────────────────────────────────────────────────────
    print(f"{BOLD}Starting servers…{RESET}\n")
    backend_proc  = start_backend()
    time.sleep(2)   # give backend a head-start
    frontend_proc = start_frontend()

    print(f"\n{GREEN}{BOLD}Both servers are starting.{RESET}")
    print(f"  Backend  → {CYAN}http://localhost:8100{RESET}")
    print(f"  Frontend → {CYAN}http://localhost:3010{RESET}")
    print(f"\n{DIM}Press Ctrl+C to stop both.{RESET}\n")

    # ── Wait & watch ─────────────────────────────────────────────────────────
    try:
        while True:
            # Restart backend if it crashes unexpectedly
            if backend_proc.poll() is not None:
                print(f"{RED}[BACKEND] Exited (code {backend_proc.returncode}). Restarting in 3s…{RESET}")
                time.sleep(3)
                backend_proc = start_backend()

            # Restart frontend if it crashes unexpectedly
            if frontend_proc.poll() is not None:
                print(f"{RED}[FRONTEND] Exited (code {frontend_proc.returncode}). Restarting in 3s…{RESET}")
                time.sleep(3)
                frontend_proc = start_frontend()

            time.sleep(2)

    except KeyboardInterrupt:
        print(f"\n{YELLOW}Shutting down…{RESET}")
        backend_proc.terminate()
        frontend_proc.terminate()
        backend_proc.wait()
        frontend_proc.wait()
        print(f"{GREEN}Stopped. Goodbye.{RESET}")


if __name__ == "__main__":
    main()
