"""Generate narration and caption timings entirely offline using Windows speech."""
import json
import re
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.demo-tools'))

OUT = ROOT / '.demo-work/v2/voice'
STORY = json.loads((ROOT / 'scripts/demo/storyboard.json').read_text(encoding='utf8'))

def main():
    if '--reuse-wav' not in sys.argv:
        subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                        str(ROOT / 'scripts/demo/voice-local.ps1')], check=True)
    if '--synthesize-only' in sys.argv:
        return
    ffmpeg = next((ROOT / '.demo-tools/imageio_ffmpeg/binaries').glob('ffmpeg*.exe'))
    for scene in STORY:
        name = scene['id']
        raw = json.loads((OUT / (name + '.raw.json')).read_text(encoding='utf-8-sig'))
        with wave.open(str(OUT / (name + '.wav'))) as wav:
            end = round(wav.getnframes() / wav.getframerate() * 1e7)
        tokens = list(re.finditer(r'\S+', scene['voice']))
        words = []
        for token in tokens:
            matches = [w for w in raw if w['position'] < token.end()
                       and w['position'] + w['count'] > token.start()]
            if not matches:
                raise ValueError('Missing word timing: ' + name + ': ' + token.group())
            words.append({'text': token.group(), 'offset': matches[0]['offset']})
        for i, word in enumerate(words):
            word['duration'] = (words[i+1]['offset'] if i+1 < len(words) else end) - word['offset']
            if word['duration'] <= 0 or word['offset'] >= end:
                raise ValueError('Word timing outside WAV: ' + name + ': ' + word['text'])
        (OUT / (name + '.json')).write_text(json.dumps(words, indent=2), encoding='utf8')
        subprocess.run([str(ffmpeg), '-v', 'error', '-y', '-i',
                        str(OUT / (name + '.wav')), '-codec:a', 'libmp3lame', '-b:a', '192k',
                        str(OUT / (name + '.mp3'))], check=True)
    (OUT / 'voice-info.json').write_text(json.dumps({
        'voice': 'Microsoft Zira Desktop', 'engine': 'Windows System.Speech',
        'offline': True, 'rate': 0, 'clips': len(STORY)
    }, indent=2))
    print('Offline narration and word timings complete.', flush=True)

if __name__ == '__main__':
    main()
