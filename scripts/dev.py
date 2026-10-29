"""Run the Python API and Vite dashboard together for local development."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def api_python() -> str:
    virtualenv_python = ROOT / ".venv" / "bin" / "python"
    python = str(virtualenv_python) if virtualenv_python.exists() else sys.executable
    check = subprocess.run(
        [python, "-c", "import uvicorn"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if check.returncode != 0:
        print(
            "Python backend dependencies are not installed.\n"
            "Run:\n"
            "  python3 -m venv .venv\n"
            "  .venv/bin/python -m pip install -r artifacts/api-server/requirements.txt",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return python


def main() -> int:
    environment = os.environ.copy()
    api_port = environment.get("API_SERVER_PORT", "8080")
    python = api_python()
    processes = [
        subprocess.Popen(
            [
                python, "-m", "uvicorn", "app.main:app",
                "--app-dir", "artifacts/api-server",
                "--host", "0.0.0.0", "--port", api_port, "--reload",
            ],
            env=environment,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        ),
    ]
    if "--api-only" not in sys.argv[1:]:
        processes.append(subprocess.Popen(
            ["pnpm", "--filter", "@workspace/purple-team-dashboard", "run", "dev"],
            env=environment,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        ))

    def stop(_signum: int | None = None, _frame: object | None = None) -> None:
        for process in processes:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        while all(process.poll() is None for process in processes):
            time.sleep(0.2)
        exit_code = next(
            (process.returncode for process in processes if process.returncode is not None),
            0,
        )
    finally:
        stop()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
