
param(
  [string]$Host = "http://localhost:3000",
  [string]$StoreId,
  [string]$Pin,
  [string]$AdminEmail,
  [string]$AdminPassword
)

# ===========================================
# Helpers
# ===========================================
$Results = New-Object System.Collections.Generic.List[object]

function Add-Result([string]$Name, [bool]$Passed, [int]$Status = 0, [string]$Note = "") {
  $Results.Add([pscustomobject]@{
    Test   = $Name
    Passed = $Passed
    Status = $Status
    Note   = $Note
  }) | Out-Null
  $color = if ($Passed) { "Green" } else { "Red" }
  $flag  = if ($Passed) { "[PASS]" } else { "[FAIL]" }
  Write-Host ("{0} {1} (HTTP {2}) {3}" -f $flag,$Name,$Status,$Note) -ForegroundColor $color
}

function Invoke-Api {
  param(
    [Parameter(Mandatory)]
    [ValidateSet('GET','POST','PATCH','DELETE')]
    [string]$Method,
    [Parameter(Mandatory)]
    [string]$Uri,
    [string]$Body,
    [hashtable]$Headers = @{},
    [string]$ContentType = "application/json"
  )
  try {
    if ($PSBoundParameters.ContainsKey('Body')) {
      $resp = Invoke-WebRequest -Method $Method -Uri $Uri -Headers $Headers -ContentType $ContentType -Body $Body -ErrorAction Stop
    } else {
      $resp = Invoke-WebRequest -Method $Method -Uri $Uri -Headers $Headers -ErrorAction Stop
    }
    $status = [int]$resp.StatusCode
    $raw = $resp.Content
    try { $json = $raw | ConvertFrom-Json } catch { $json = $null }
    return [pscustomobject]@{ Status = $status; Body = $json; Raw = $raw; Headers = $resp.Headers }
  } catch {
    $we = $_.Exception
    $resp = $we.Response
    if ($null -ne $resp) {
      $status = [int]$resp.StatusCode.Value__
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $raw = $reader.ReadToEnd()
      try { $json = $raw | ConvertFrom-Json } catch { $json = $null }
      return [pscustomobject]@{ Status = $status; Body = $json; Raw = $raw; Headers = $resp.Headers }
    } else {
      return [pscustomobject]@{ Status = 0; Body = $null; Raw = $we.Message; Headers = $null }
    }
  }
}

function ToJsonBody($obj, $depth = 10) {
  return ($obj | ConvertTo-Json -Compress -Depth $depth)
}

function Expect([string]$Name, $resp, [int[]]$OkCodes) {
  $ok = ($resp -and $OkCodes -contains [int]$resp.Status)
  $note = if ($resp.Raw) { $resp.Raw.Substring(0, [Math]::Min(200, $resp.Raw.Length)) } else { "" }
  Add-Result -Name $Name -Passed $ok -Status $resp.Status -Note $note
  return $ok
}

# Basic display
Write-Host "=== YubiWait Smoke Test (PS 5.1 compatible) ===" -ForegroundColor Cyan
Write-Host ("Host: {0}" -f $Host)
if ($StoreId) { Write-Host ("StoreId: {0}" -f $StoreId) }
if ($Pin)     { Write-Host ("Pin: {0}" -f $Pin) }
if ($AdminEmail) { Write-Host ("AdminEmail: {0}" -f $AdminEmail) }

# ===========================================
# 0) Store list (and optionally choose StoreId)
# ===========================================
$resp = Invoke-Api -Method GET -Uri "$Host/api/store/list"
if (Expect "GET /api/store/list" $resp @(200)) {
  if (-not $StoreId) {
    if ($resp.Body -and $resp.Body[0]._id) {
      $StoreId = $resp.Body[0]._id
      Write-Host ("[INFO] StoreId 未指定のため、{0} を使用します" -f $StoreId) -ForegroundColor Yellow
    } else {
      Add-Result "StoreId resolved" $false 0 "店舗が見つかりませんでした"
      goto FINISH
    }
  }
}

# sanity check for ObjectId format
if (-not ($StoreId -match '^[0-9a-fA-F]{24}$')) {
  Add-Result "Validate StoreId format" $false 0 "StoreId は24桁hexである必要があります"
  goto FINISH
} else {
  Add-Result "Validate StoreId format" $true 0 ""
}

# ===========================================
# 1) Staff login
# ===========================================
if (-not $Pin) {
  Write-Host "[WARN] Pin が未指定のためスタッフ系テストをスキップ" -ForegroundColor Yellow
  $skipStaff = $true
} else {
  $body = ToJsonBody @{ storeId = $StoreId; pinCode = $Pin }
  $resp = Invoke-Api -Method POST -Uri "$Host/api/store/staff-login" -Body $body
  if (Expect "POST /api/store/staff-login" $resp @(200)) {
    $staffToken = $resp.Body.token
    $hStaff = @{ Authorization = "Bearer $staffToken" }
  }
}

# ===========================================
# 2) Staff API tests
# ===========================================
if (-not $skipStaff) {
  # 401 test (no header)
  $uri = "$Host/api/staff/$StoreId?status=all"
  $unauth = Invoke-Api -Method GET -Uri $uri
  Expect "GET /api/staff/:storeId?status=all (no token → 401)" $unauth @(401) | Out-Null

  # 200 with token
  $resp = Invoke-Api -Method GET -Uri $uri -Headers $hStaff
  $ok = Expect "GET /api/staff/:storeId?status=all (with token)" $resp @(200)

  # 400 invalid status
  $bad = Invoke-Api -Method GET -Uri "$Host/api/staff/$StoreId?status=unknown" -Headers $hStaff
  Expect "GET /api/staff/:storeId?status=unknown → 400" $bad @(400) | Out-Null

  # 400 bad store id
  $bad2 = Invoke-Api -Method GET -Uri "$Host/api/staff/BAD?status=all" -Headers $hStaff
  Expect "GET /api/staff/BAD?status=all → 400" $bad2 @(400) | Out-Null
}

# ===========================================
# 3) Join (customer)
# ===========================================
$rand = Get-Random -Minimum 1000 -Maximum 9999
$joinName = "テスト太郎$rand"
$joinBody = ToJsonBody @{ name = $joinName }
$resp = Invoke-Api -Method POST -Uri "$Host/api/join/$StoreId" -Body $joinBody
if (Expect "POST /api/join/:storeId (正常)" $resp @(200)) {
  $customerId = $resp.Body.customerId
  $cancelToken = $resp.Body.cancelToken
}

# name 空 → 400
$badName = ToJsonBody @{ name = "" }
$resp = Invoke-Api -Method POST -Uri "$Host/api/join/$StoreId" -Body $badName
Expect "POST /api/join/:storeId (name空 → 400)" $resp @(400) | Out-Null

# ===========================================
# 4) waiting-time
# ===========================================
$resp = Invoke-Api -Method GET -Uri "$Host/api/join/$StoreId/waiting-time"
Expect "GET /api/join/:storeId/waiting-time (no customerId)" $resp @(200) | Out-Null

if ($customerId) {
  $resp = Invoke-Api -Method GET -Uri "$Host/api/join/$StoreId/waiting-time?customerId=$customerId"
  Expect "GET /waiting-time?customerId=... (24hex)" $resp @(200) | Out-Null
}

$resp = Invoke-Api -Method GET -Uri "$Host/api/join/$StoreId/waiting-time?customerId=BAD"
Expect "GET /waiting-time?customerId=BAD → 400" $resp @(400) | Out-Null

# ===========================================
# 5) cancel
# ===========================================
if ($customerId) {
  # 本人性なし → 400 or 403
  $cancelBody = ToJsonBody @{ customerId = $customerId }
  $resp = Invoke-Api -Method DELETE -Uri "$Host/api/join/$StoreId/cancel" -Body $cancelBody
  Expect "DELETE /cancel (本人性なし → 400/403)" $resp @(400,403) | Out-Null

  if ($cancelToken) {
    $okBody = ToJsonBody @{ customerId = $customerId; cancelToken = $cancelToken }
    $resp = Invoke-Api -Method DELETE -Uri "$Host/api/join/$StoreId/cancel" -Body $okBody
    Expect "DELETE /cancel (cancelTokenでOK)" $resp @(200) | Out-Null
  }
}

# ===========================================
# 6) Admin login (optional)
# ===========================================
if ($AdminEmail -and $AdminPassword) {
  $body = ToJsonBody @{ email = $AdminEmail; password = $AdminPassword }
  $resp = Invoke-Api -Method POST -Uri "$Host/api/admin/auth/login" -Body $body
  if (Expect "POST /api/admin/auth/login" $resp @(200)) {
    $adminToken = $resp.Body.token
    $hAdmin = @{ Authorization = "Bearer $adminToken" }

    # settings GET
    $resp = Invoke-Api -Method GET -Uri "$Host/api/admin/stores/$StoreId/settings" -Headers $hAdmin
    if (Expect "GET /admin/stores/:id/settings" $resp @(200)) {
      $current = $resp.Body

      # defaults for PS 5.1 (no ?? or ternary)
      $autoEnabled = $true
      if ($null -ne $current.autoCallerEnabled) { $autoEnabled = [bool]$current.autoCallerEnabled }

      $maxServingVal = 1
      if ($null -ne $current.maxServing) { $maxServingVal = [int]$current.maxServing }

      $wait = 5
      if ($null -ne $current.waitMinutesPerPerson) { $wait = [int]$current.waitMinutesPerPerson }

      # notification templates (string or object)
      $nearBody = "あと{{n}}人です"
      $readyBody = "ご案内できます"
      if ($current.notificationTemplate) {
        $nt = $current.notificationTemplate
        if ($nt.near) {
          if ($nt.near -is [string]) { $nearBody = $nt.near }
          elseif ($nt.near.body) { $nearBody = $nt.near.body }
        }
        if ($nt.ready) {
          if ($nt.ready -is [string]) { $readyBody = $nt.ready }
          elseif ($nt.ready.body) { $readyBody = $nt.ready.body }
        }
      }

      $payload = ToJsonBody @{
        autoCallerEnabled    = $autoEnabled
        maxServing           = $maxServingVal
        waitMinutesPerPerson = $wait
        notificationTemplate = @{
          near  = @{ title = ""; body = $nearBody }
          ready = @{ title = ""; body = $readyBody }
        }
      }

      $resp2 = Invoke-Api -Method PATCH -Uri "$Host/api/admin/stores/$StoreId/settings" -Headers $hAdmin -Body $payload
      Expect "PATCH /admin/stores/:id/settings (正常)" $resp2 @(200) | Out-Null

      # invalid patch: maxServing=0 → 400
      $badPayload = ToJsonBody @{ autoCallerEnabled = $true; maxServing = 0; waitMinutesPerPerson = $wait }
      $resp3 = Invoke-Api -Method PATCH -Uri "$Host/api/admin/stores/$StoreId/settings" -Headers $hAdmin -Body $badPayload
      Expect "PATCH /admin/stores/:id/settings (maxServing=0 → 400)" $resp3 @(400) | Out-Null
    }

    # metrics valid
    $from = (Get-Date).AddDays(-7).ToString('yyyy-MM-dd')
    $to   = (Get-Date).ToString('yyyy-MM-dd')
    $resp = Invoke-Api -Method GET -Uri "$Host/api/admin/stores/$StoreId/metrics?from=$from&to=$to" -Headers $hAdmin
    Expect "GET /admin/stores/:id/metrics (valid from/to)" $resp @(200) | Out-Null

    # metrics invalid date → 400
    $resp = Invoke-Api -Method GET -Uri "$Host/api/admin/stores/$StoreId/metrics?from=2025/08/01" -Headers $hAdmin
    Expect "GET /admin/stores/:id/metrics (bad date → 400)" $resp @(400) | Out-Null

    # history
    $resp = Invoke-Api -Method GET -Uri "$Host/api/admin/stores/$StoreId/history?limit=50&from=$from&to=$to" -Headers $hAdmin
    Expect "GET /admin/stores/:id/history (valid)" $resp @(200) | Out-Null
  }
} else {
  Write-Host "[INFO] AdminEmail/AdminPassword 未指定のため管理APIテストはスキップ" -ForegroundColor Yellow
}

# ===========================================
# FINISH & SUMMARY
# ===========================================
:FINISH
$pass = ($Results | Where-Object { $_.Passed }).Count
$total = $Results.Count
$fail = $total - $pass

Write-Host ""
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
$Results | Format-Table -AutoSize

Write-Host ""
if ($fail -eq 0) {
  Write-Host ("ALL PASSED ({0}/{1})" -f $pass, $total) -ForegroundColor Green
  exit 0
} else {
  Write-Host ("FAILED {0} TESTS ({1}/{2} passed)" -f $fail, $pass, $total) -ForegroundColor Red
  exit 1
}
