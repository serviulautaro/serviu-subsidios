$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$script = Join-Path $repo 'scripts\sincronizar_r2_computador.js'
$root = if ($env:SERVIU_R2_LOCAL_DIR) {
  $env:SERVIU_R2_LOCAL_DIR
} else {
  Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Documentos Entidad Patrocinante R2'
}
$estado = Join-Path $root '_estado'
New-Item -ItemType Directory -Path $estado -Force | Out-Null
$log = Join-Path $estado 'tarea_programada.log'
Push-Location $repo
try {
  & node $script *>> $log
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
