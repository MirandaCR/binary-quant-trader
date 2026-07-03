@echo off
setlocal
set "ROOT=%~dp0"

if /I "%1"=="backend" goto backend
if /I "%1"=="frontend" goto frontend

echo Starting backend and frontend...
start "Backend" cmd /k ""%ROOT%start_all.bat" backend"
start "Frontend" cmd /k ""%ROOT%start_all.bat" frontend"
exit /b 0

:backend
cd /d "%ROOT%backend"
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)
call venv\Scripts\activate
echo Installing dependencies...
pip install -r requirements.txt
echo.
echo Starting backend on http://localhost:8000
python main.py
pause
exit /b 0

:frontend
cd /d "%ROOT%frontend"
if not exist "node_modules" (
    echo Installing npm packages...
    npm install
)
echo.
echo Starting frontend on http://localhost:3000
npm run dev
pause
exit /b 0
