param(
    [string]$JavaDirectory = 'C:/Program Files/Android/Android Studio/jbr',
    [string]$SdkDirectory = "$env:LOCALAPPDATA/Android/Sdk",
    [switch]$InitializeSigning
)
$ErrorActionPreference = 'Stop'
$taskAndroidDirectory = $PSScriptRoot
$taskRepository = Split-Path $PSScriptRoot -Parent
$taskKeyFile = Join-Path $taskAndroidDirectory 'keystore/release.jks'
$taskSigningFile = Join-Path $taskAndroidDirectory 'signing.properties'
if (-not (Test-Path -LiteralPath "$JavaDirectory/bin/java.exe")) { throw 'JDK 17 or later is required. Pass -JavaDirectory.' }
if (-not (Test-Path -LiteralPath "$SdkDirectory/platforms/android-36/android.jar")) { throw 'Android SDK platform 36 is required. Pass -SdkDirectory.' }

if ($InitializeSigning) {
    if ((Test-Path -LiteralPath $taskKeyFile) -or (Test-Path -LiteralPath $taskSigningFile)) { throw 'Signing files already exist. Keep the existing key for app updates.' }
    New-Item -ItemType Directory -Force -Path (Split-Path $taskKeyFile -Parent) | Out-Null
    $taskBytes = New-Object byte[] 32
    $taskRandom = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $taskRandom.GetBytes($taskBytes)
    $taskRandom.Dispose()
    $env:SRC_APP_SIGN_PASSWORD = [Convert]::ToBase64String($taskBytes)
    try {
        & "$JavaDirectory/bin/keytool.exe" -genkeypair -keystore $taskKeyFile -storetype JKS -storepass:env SRC_APP_SIGN_PASSWORD -keypass:env SRC_APP_SIGN_PASSWORD -alias src-leaderboard -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000 -dname 'CN=Samsung Rowing Club Leaderboard, OU=Club App, O=Samsung Rowing Club, C=KR'
        if ($LASTEXITCODE -ne 0) { throw 'Signing key creation failed.' }
        Set-Content -LiteralPath $taskSigningFile -Encoding ascii -Value "storeFile=keystore/release.jks`nstorePassword=$env:SRC_APP_SIGN_PASSWORD`nkeyAlias=src-leaderboard`nkeyPassword=$env:SRC_APP_SIGN_PASSWORD"
    } finally { Remove-Item Env:SRC_APP_SIGN_PASSWORD -ErrorAction SilentlyContinue }
}
if (-not (Test-Path -LiteralPath $taskKeyFile) -or -not (Test-Path -LiteralPath $taskSigningFile)) { throw 'Restore the original signing files, or initialize a new app with -InitializeSigning.' }
Set-Content -LiteralPath "$taskAndroidDirectory/local.properties" -Encoding ascii -Value ('sdk.dir=' + $SdkDirectory.Replace('\','/').Replace(':','\:'))
$env:JAVA_HOME = $JavaDirectory
& "$taskAndroidDirectory/gradlew.bat" -p $taskAndroidDirectory --no-daemon assembleRelease lintRelease
if ($LASTEXITCODE -ne 0) { throw 'Android build or lint failed.' }

$taskClasses = Join-Path $taskAndroidDirectory 'app/build/navigation-tests'
New-Item -ItemType Directory -Force -Path $taskClasses | Out-Null
& "$JavaDirectory/bin/javac.exe" -encoding UTF-8 -d $taskClasses "$taskAndroidDirectory/app/src/main/java/io/github/firefly247/srcleaderboard/NavigationPolicy.java" "$taskAndroidDirectory/app/src/test/java/io/github/firefly247/srcleaderboard/NavigationPolicyTest.java"
if ($LASTEXITCODE -ne 0) { throw 'Navigation test compilation failed.' }
& "$JavaDirectory/bin/java.exe" -cp $taskClasses io.github.firefly247.srcleaderboard.NavigationPolicyTest
if ($LASTEXITCODE -ne 0) { throw 'Navigation tests failed.' }

$taskApk = Join-Path $taskAndroidDirectory 'app/build/outputs/apk/release/app-release.apk'
& "$SdkDirectory/build-tools/36.1.0/apksigner.bat" verify --verbose $taskApk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$taskOutput = Join-Path $taskRepository 'downloads'
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
Copy-Item -LiteralPath $taskApk -Destination "$taskOutput/samsung-rowing-club.apk" -Force
$taskBuild = Get-Content -LiteralPath "$taskAndroidDirectory/app/build.gradle" -Raw
$taskVersion = [regex]::Match($taskBuild,"versionName '([^']+)'").Groups[1].Value
$taskCode = [int][regex]::Match($taskBuild,'versionCode (\d+)').Groups[1].Value
$taskMetadata = [ordered]@{
    applicationId = 'io.github.firefly247.srcleaderboard'
    versionName = $taskVersion
    versionCode = $taskCode
    minSdkVersion = 26
    targetSdkVersion = 36
    file = 'samsung-rowing-club.apk'
    bytes = (Get-Item -LiteralPath $taskApk).Length
    sha256 = (Get-FileHash -LiteralPath $taskApk -Algorithm SHA256).Hash.ToLowerInvariant()
}
$taskMetadata | ConvertTo-Json | Set-Content -LiteralPath "$taskOutput/android-release.json" -Encoding utf8
Write-Output "Signed APK ready: $taskOutput/samsung-rowing-club.apk"
