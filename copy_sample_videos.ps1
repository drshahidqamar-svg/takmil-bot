# Source folder containing the sample video
$sourceFolder = "C:\Users\qamar\OneDrive\Desktop\Math\Level 1"

# Target folders
$targets = @(
    @{
        Folder = "C:\Users\qamar\OneDrive\Desktop\Math\Level 1\Unit1\Additon"
        Title  = "Math_Level1_Unit1_Addition_Test"
    },
    @{
        Folder = "C:\Users\qamar\OneDrive\Desktop\Urdu\Level 1\Unit1"
        Title  = "Urdu_Level1_Unit1_Test"
    },
    @{
        Folder = "C:\Users\qamar\OneDrive\Desktop\Science\Level 1\Unit1"
        Title  = "Science_Level1_Unit1_Test"
    },
    @{
        Folder = "C:\Users\qamar\OneDrive\Desktop\English\Level 1\Unit1"
        Title  = "English_Level1_Unit1_Test"
    }
)

# Find first video file in source folder
$video = Get-ChildItem -Path $sourceFolder -File |
    Where-Object { $_.Extension -match "\.(mp4|mov|avi|mkv|wmv)$" } |
    Select-Object -First 1

if (-not $video) {
    Write-Host "No video file found in: $sourceFolder" -ForegroundColor Red
    exit
}

Write-Host "Sample video found: $($video.Name)" -ForegroundColor Green

foreach ($target in $targets) {

    # Create folder if it does not exist
    if (-not (Test-Path $target.Folder)) {
        New-Item -ItemType Directory -Path $target.Folder -Force | Out-Null
    }

    # New fake title file name
    $newFileName = $target.Title + $video.Extension
    $destination = Join-Path $target.Folder $newFileName

    # Copy video
    Copy-Item -Path $video.FullName -Destination $destination -Force

    Write-Host "Copied to: $destination" -ForegroundColor Cyan
}

Write-Host "Done. Sample video copied for Math, Urdu, Science, and English testing." -ForegroundColor Green