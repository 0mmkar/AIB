$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies ([System.Speech.Synthesis.SpeechSynthesizer].Assembly.Location) -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Speech.Synthesis;
using System.Speech.AudioFormat;
public class DemoWord {
    public string text;
    public int position;
    public int count;
    public long offset;
}
public static class LocalDemoVoice {
    public static List<DemoWord> Generate(string text, string output) {
        var words = new List<DemoWord>();
        using (var voice = new SpeechSynthesizer()) {
            voice.SelectVoice("Microsoft Zira Desktop");
            voice.Rate = 0;
            voice.SpeakProgress += (sender, e) => words.Add(new DemoWord {
                text = e.Text, position = e.CharacterPosition,
                count = e.CharacterCount, offset = e.AudioPosition.Ticks
            });
            voice.SetOutputToWaveFile(output,
                new SpeechAudioFormatInfo(16000, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
            voice.Speak(text);
        }
        return words;
    }
}
'@
$demoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$voiceRoot = Join-Path $demoRoot '.demo-work/v2/voice'
New-Item -ItemType Directory -Force -Path $voiceRoot | Out-Null
$story = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'storyboard.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($scene in $story) {
    $wavePath = Join-Path $voiceRoot ($scene.id + '.wav')
    $words = [LocalDemoVoice]::Generate($scene.voice, $wavePath)
    $words | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $voiceRoot ($scene.id + '.raw.json')) -Encoding UTF8
    Write-Output ('Narrated locally: ' + $scene.id)
}
