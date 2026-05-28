@echo off
cd /d "C:\Users\JORGE\Documents\New project\serviu-clean"
if not exist "C:\Users\JORGE\Desktop\Respaldo de documentos\_logs" mkdir "C:\Users\JORGE\Desktop\Respaldo de documentos\_logs"
npm run backup:documentos:local >> "C:\Users\JORGE\Desktop\Respaldo de documentos\_logs\tarea_respaldo_documentos.log" 2>>&1
