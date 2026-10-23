# Servidor local do Painel da Frota.
# - Serve o app em http://localhost:<porta>/
# - Grava os dados em dados\base.json e as planilhas originais em dados\importacoes\
# - A cada gravação faz commit no git (e push, se houver remoto "origin")
# - Nunca aceita uma gravação que tenha MENOS registros do que a base atual.

param([int]$Porta = 8765, [switch]$SemNavegador)

$ErrorActionPreference = 'Stop'
if ($env:PORT -and -not $PSBoundParameters.ContainsKey('Porta')) { $Porta = [int]$env:PORT }
$Raiz      = Split-Path -Parent $PSScriptRoot
$Dados     = Join-Path $Raiz 'dados'
$Importes  = Join-Path $Dados 'importacoes'
$Backups   = Join-Path $Dados '.backups'
$BaseJson  = Join-Path $Dados 'base.json'
$Utf8      = New-Object System.Text.UTF8Encoding($false)

foreach ($p in @($Dados, $Importes, $Backups)) { if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }

function Escrever-Log([string]$msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) }

function Executar-Git([string[]]$argumentos, [int]$timeoutSeg = 120) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'git'
    $psi.Arguments = ($argumentos | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
    $psi.WorkingDirectory = $Raiz
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = $Utf8
    $psi.StandardErrorEncoding = $Utf8
    $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
    try { $proc = [System.Diagnostics.Process]::Start($psi) } catch { return @{ codigo = -1; saida = "git não encontrado: $($_.Exception.Message)" } }
    $tOut = $proc.StandardOutput.ReadToEndAsync()
    $tErr = $proc.StandardError.ReadToEndAsync()
    if (-not $proc.WaitForExit($timeoutSeg * 1000)) { try { $proc.Kill() } catch {}; return @{ codigo = -2; saida = 'tempo esgotado' } }
    return @{ codigo = $proc.ExitCode; saida = ($tOut.Result + $tErr.Result).Trim() }
}

function Status-Git {
    $repo = (Executar-Git @('rev-parse', '--is-inside-work-tree')).codigo -eq 0
    $remoto = $false; $ultimo = ''; $pendentes = 0
    if ($repo) {
        $r = Executar-Git @('remote', 'get-url', 'origin')
        $remoto = $r.codigo -eq 0
        $l = Executar-Git @('log', '-1', '--format=%cd|%s', '--date=format:%d/%m/%Y %H:%M')
        if ($l.codigo -eq 0) { $ultimo = $l.saida }
        $s = Executar-Git @('status', '--porcelain', '--', 'dados')
        if ($s.codigo -eq 0 -and $s.saida) { $pendentes = @($s.saida -split "`n").Count }
    }
    return @{ repositorio = $repo; remoto = $remoto; ultimoCommit = $ultimo; pendentes = $pendentes }
}

function Salvar-No-Git([string]$mensagem) {
    $res = @{ commit = $false; push = $false; detalhe = '' }
    if ((Executar-Git @('rev-parse', '--is-inside-work-tree')).codigo -ne 0) { $res.detalhe = 'Pasta sem git: dados salvos só no computador.'; return $res }
    Executar-Git @('add', '--', 'dados') | Out-Null
    $c = Executar-Git @('commit', '-m', $mensagem, '--', 'dados')
    $res.commit = ($c.codigo -eq 0)
    if (-not $res.commit -and $c.saida -notmatch 'nothing to commit|nada a submeter|nothing added') { $res.detalhe = "Falha no commit: $($c.saida)"; return $res }
    if ((Executar-Git @('remote', 'get-url', 'origin')).codigo -eq 0) {
        $p = Executar-Git @('push', 'origin', 'HEAD') 180
        $res.push = ($p.codigo -eq 0)
        if (-not $res.push) { $res.detalhe = "Commit feito, mas o envio ao GitHub falhou: $($p.saida)" }
    } else { $res.detalhe = 'Commit feito no computador. Ainda não há GitHub configurado (remoto origin).' }
    return $res
}

# Conta registros pelo bloco "resumo" que o app grava no topo do base.json
function Contar([string]$json) {
    $c = @{}
    foreach ($k in @('abastecimentos', 'multas', 'frota')) {
        $m = [regex]::Match($json, '"total_' + $k + '"\s*:\s*(\d+)')
        $c[$k] = if ($m.Success) { [int]$m.Groups[1].Value } else { -1 }
    }
    return $c
}

function Ler-Corpo-Texto($req) { $sr = New-Object System.IO.StreamReader($req.InputStream, $Utf8); try { $sr.ReadToEnd() } finally { $sr.Dispose() } }
function Ler-Corpo-Bytes($req) { $ms = New-Object System.IO.MemoryStream; $req.InputStream.CopyTo($ms); $ms.ToArray() }

function Responder($ctx, [int]$status, [string]$tipo, [byte[]]$bytes) {
    $ctx.Response.StatusCode = $status
    $ctx.Response.ContentType = $tipo
    $ctx.Response.Headers['Cache-Control'] = 'no-store'
    $ctx.Response.ContentLength64 = $bytes.Length
    if ($ctx.Request.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
}
function Responder-Json($ctx, [int]$status, $obj) { Responder $ctx $status 'application/json; charset=utf-8' ($Utf8.GetBytes(($obj | ConvertTo-Json -Depth 6 -Compress))) }

function Param-Url($req, [string]$chave) {
    foreach ($par in $req.Url.Query.TrimStart('?') -split '&') {
        $kv = $par -split '=', 2
        if ($kv[0] -eq $chave -and $kv.Count -eq 2) { return [Uri]::UnescapeDataString(($kv[1] -replace '\+', ' ')) }
    }
    return ''
}

function Nome-Seguro([string]$n) { ($n -replace '[\\/:*?"<>|]', '_').Trim() }

$Tipos = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8' }

function Tratar($ctx) {
    $req = $ctx.Request
    $caminho = [Uri]::UnescapeDataString($req.Url.AbsolutePath)

    if ($caminho -eq '/api/status' -and $req.HttpMethod -eq 'GET') { Responder-Json $ctx 200 (Status-Git); return }

    if ($caminho -eq '/api/base' -and $req.HttpMethod -eq 'GET') {
        if (Test-Path $BaseJson) { Responder $ctx 200 'application/json; charset=utf-8' ([IO.File]::ReadAllBytes($BaseJson)) }
        else { Responder-Json $ctx 200 @{ vazio = $true } }
        return
    }

    # Guarda uma cópia da planilha original, exatamente como foi importada
    if ($caminho -eq '/api/arquivo' -and $req.HttpMethod -eq 'POST') {
        $nome = Nome-Seguro (Param-Url $req 'nome')
        if (-not $nome) { Responder-Json $ctx 400 @{ erro = 'nome ausente' }; return }
        $pasta = Join-Path $Importes (Get-Date -Format 'yyyy-MM')
        if (-not (Test-Path $pasta)) { New-Item -ItemType Directory -Path $pasta | Out-Null }
        $destino = Join-Path $pasta ((Get-Date -Format 'yyyy-MM-dd_HHmmss') + '_' + $nome)
        [IO.File]::WriteAllBytes($destino, (Ler-Corpo-Bytes $req))
        Escrever-Log "Planilha guardada: $destino"
        Responder-Json $ctx 200 @{ ok = $true; arquivo = $destino.Substring($Raiz.Length + 1) }
        return
    }

    # Grava a base consolidada e faz commit
    if ($caminho -eq '/api/base' -and $req.HttpMethod -eq 'POST') {
        $novo = Ler-Corpo-Texto $req
        if (-not $novo.TrimStart().StartsWith('{')) { Responder-Json $ctx 400 @{ erro = 'conteúdo inválido' }; return }
        $cn = Contar $novo
        if ($cn.abastecimentos -lt 0) { Responder-Json $ctx 400 @{ erro = 'base sem resumo' }; return }
        if (Test-Path $BaseJson) {
            $atual = [IO.File]::ReadAllText($BaseJson, $Utf8)
            $ca = Contar $atual
            foreach ($k in $ca.Keys) {
                if ($cn[$k] -lt $ca[$k]) {
                    Escrever-Log "RECUSADO: $k cairia de $($ca[$k]) para $($cn[$k])"
                    Responder-Json $ctx 409 @{ erro = "Gravação recusada para proteger os dados: $k cairia de $($ca[$k]) para $($cn[$k])." }
                    return
                }
            }
            Copy-Item $BaseJson (Join-Path $Backups ("base_" + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.json'))
            Get-ChildItem $Backups -Filter 'base_*.json' | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item -Force
        }
        $tmp = "$BaseJson.tmp"
        [IO.File]::WriteAllText($tmp, $novo, $Utf8)
        if (Test-Path $BaseJson) { [IO.File]::Replace($tmp, $BaseJson, [NullString]::Value) } else { [IO.File]::Move($tmp, $BaseJson) }
        $msg = Param-Url $req 'msg'; if (-not $msg) { $msg = 'Atualiza dados' }
        $msg = "$msg (" + (Get-Date -Format 'dd/MM/yyyy HH:mm') + ")"
        $git = Salvar-No-Git $msg
        Escrever-Log "Base gravada: $($cn.abastecimentos) abastecimentos, $($cn.multas) multas, $($cn.frota) veículos. Commit: $($git.commit) Push: $($git.push) $($git.detalhe)"
        Responder-Json $ctx 200 @{ ok = $true; git = $git }
        return
    }

    if ($req.HttpMethod -notin 'GET', 'HEAD') { Responder-Json $ctx 405 @{ erro = 'método não permitido' }; return }

    # Arquivos estáticos (nunca serve .git, servidor ou dados)
    if ($caminho -eq '/') { $caminho = '/index.html' }
    $rel = $caminho.TrimStart('/') -replace '/', '\'
    $arq = [IO.Path]::GetFullPath((Join-Path $Raiz $rel))
    $bloq = $rel -match '^(\.git|servidor|dados)(\\|$)'
    if ($bloq -or -not $arq.StartsWith($Raiz, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $arq -PathType Leaf)) {
        Responder $ctx 404 'text/plain; charset=utf-8' ($Utf8.GetBytes('Não encontrado')); return
    }
    $ext = [IO.Path]::GetExtension($arq).ToLower()
    $tipo = if ($Tipos.ContainsKey($ext)) { $Tipos[$ext] } else { 'application/octet-stream' }
    Responder $ctx 200 $tipo ([IO.File]::ReadAllBytes($arq))
}

$escuta = New-Object System.Net.HttpListener
$escuta.Prefixes.Add("http://localhost:$Porta/")
try { $escuta.Start() } catch {
    Write-Host "Não foi possível abrir a porta $Porta. O painel já está aberto em outra janela?" -ForegroundColor Yellow
    if (-not $SemNavegador) { Start-Process "http://localhost:$Porta/" }
    exit 1
}

Write-Host ''
Write-Host '  PAINEL DA FROTA' -ForegroundColor Cyan
Write-Host "  Aberto em http://localhost:$Porta/"
Write-Host '  Deixe esta janela aberta enquanto usa o painel. Feche-a para encerrar.'
Write-Host ''
if (-not $SemNavegador) { Start-Process "http://localhost:$Porta/" }

while ($escuta.IsListening) {
    $ctx = $escuta.GetContext()
    try { Tratar $ctx }
    catch {
        Escrever-Log "Erro: $($_.Exception.Message)"
        try { Responder-Json $ctx 500 @{ erro = $_.Exception.Message } } catch {}
    }
    finally { try { $ctx.Response.Close() } catch {} }
}
