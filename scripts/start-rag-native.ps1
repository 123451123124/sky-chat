$ErrorActionPreference = 'Stop'
$taskProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskServices = Join-Path $taskProjectRoot '.data/services'
$taskEsHome = Join-Path $taskServices 'runtime/elasticsearch-8.19.0'
$taskKafkaHome = Join-Path $taskServices 'runtime/kafka_2.13-3.9.1'
$taskJava = (Get-Command java -ErrorAction Stop).Source
$taskClassPath = Join-Path $taskKafkaHome 'libs/*'
$taskKafkaConfig = Join-Path $taskServices 'kafka.properties'
if (-not (Test-Path -LiteralPath (Join-Path $taskEsHome 'bin/elasticsearch.bat'))) { throw 'Run scripts/setup-rag-native.py first' }
if (-not (Test-Path -LiteralPath (Join-Path $taskServices 'kafka-data/meta.properties'))) {
  & $taskJava -cp $taskClassPath kafka.tools.StorageTool format -t U2t5Q2hhdFJhZ0xvY2FsMQ -c $taskKafkaConfig
  if ($LASTEXITCODE -ne 0) { throw 'Kafka storage initialization failed' }
}
if (-not (Get-NetTCPConnection -LocalPort 19200 -State Listen -ErrorAction SilentlyContinue)) {
  $taskEsCommand = '"' + (Join-Path $taskEsHome 'bin/elasticsearch.bat') + '"'
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $taskEsCommand) -WorkingDirectory $taskEsHome -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskServices 'es-stdout.log') -RedirectStandardError (Join-Path $taskServices 'es-stderr.log') | Out-Null
}
if (-not (Get-NetTCPConnection -LocalPort 19092 -State Listen -ErrorAction SilentlyContinue)) {
  $taskArguments = @('-Xms256m','-Xmx512m','-cp',('"'+$taskClassPath+'"'),'kafka.Kafka',('"'+$taskKafkaConfig+'"'))
  Start-Process -FilePath $taskJava -ArgumentList $taskArguments -WorkingDirectory $taskKafkaHome -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskServices 'kafka-stdout.log') -RedirectStandardError (Join-Path $taskServices 'kafka-stderr.log') | Out-Null
}
Write-Output 'Native ES/IK and Kafka launched on loopback; logs in .data/services. These are not startup services.'
