@echo off
title Medical Question Auditor & Validator (Port 3000)
cd /d "%~dp0"
echo Starting Medical Question Auditor & Validator on http://localhost:3000 ...
start "" http://localhost:3000
npx.cmd next start -p 3000
pause
