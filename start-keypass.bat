@echo off
title KeyPass — Serveur hôtelier
color 0A

echo.
echo  ██╗  ██╗███████╗██╗   ██╗██████╗  █████╗ ███████╗███████╗
echo  ██║ ██╔╝██╔════╝╚██╗ ██╔╝██╔══██╗██╔══██╗██╔════╝██╔════╝
echo  █████╔╝ █████╗   ╚████╔╝ ██████╔╝███████║███████╗███████╗
echo  ██╔═██╗ ██╔══╝    ╚██╔╝  ██╔═══╝ ██╔══██║╚════██║╚════██║
echo  ██║  ██╗███████╗   ██║   ██║     ██║  ██║███████║███████║
echo  ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝
echo.
echo  Démarrage du serveur...
echo  Ne pas fermer cette fenêtre.
echo.

cd /d "%~dp0"
node server.js

echo.
echo  Le serveur s'est arrêté. Appuyez sur une touche pour relancer.
pause > nul
start "" "%~f0"
