$port = 8080
$url = "http://localhost:$port"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("$url/")

try {
    $listener.Start()
    Write-Host "ADFinanças rodando em $url" -ForegroundColor Cyan
    Write-Host "Pressione CTRL+C para parar o servidor."
    
    # Open browser
    Start-Process $url

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.LocalPath
        if ($path -eq "/") { $path = "/index.html" }
        
        $filePath = Join-Path $PWD $path
        
        if (Test-Path $filePath -PathType Leaf) {
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $extension = [System.IO.Path]::GetExtension($filePath)
            
            $contentType = switch ($extension) {
                ".html" { "text/html" }
                ".css"  { "text/css" }
                ".js"   { "application/javascript" }
                ".json" { "application/json" }
                ".png"  { "image/png" }
                ".wasm" { "application/wasm" }
                default { "application/octet-stream" }
            }
            
            $response.ContentType = $contentType
            $response.ContentLength64 = $content.Length
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
    }
} catch {
    Write-Host "Erro ao iniciar servidor: $_" -ForegroundColor Red
} finally {
    $listener.Stop()
}
