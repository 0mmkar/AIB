"""Verify finished media and create a contact sheet from the actual encoded MP4."""
import json
import math
import re
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'.demo-tools'))
import imageio_ffmpeg
FFMPEG=imageio_ffmpeg.get_ffmpeg_exe()
OUT=ROOT/'deliverables/client-demo-v2'
WORK=ROOT/'.demo-work/v2'
VIDEO=OUT/'AIB-Life-Application-Demo.mp4'

if '--normalise' in sys.argv:
    destination=WORK/'normalised-demo.mp4'
    subprocess.run([FFMPEG,'-v','error','-y','-i',str(VIDEO),'-map','0:v','-map','0:a','-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-ar','48000','-c:a','aac','-b:a','192k','-movflags','+faststart',str(destination)],check=True)
    destination.replace(VIDEO)
    print('Audio normalised for presentation playback.',flush=True)

info=subprocess.run([FFMPEG,'-hide_banner','-i',str(VIDEO)],capture_output=True,text=True).stderr
assert '1920x1080' in info and '24 fps' in info,info
assert 'Video: h264' in info and 'Audio: aac' in info,info
check=subprocess.run([FFMPEG,'-v','error','-i',str(VIDEO),'-f','null','-'],capture_output=True,text=True)
assert check.returncode==0 and not check.stderr,check.stderr

def seconds(stamp):
    hh,mm,ss=stamp.replace(',','.').split(':');return int(hh)*3600+int(mm)*60+float(ss)
cues=re.findall(r'(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})', (OUT/'captions.srt').read_text())
previous=0
for start,end in cues:
    a,b=seconds(start),seconds(end)
    assert a>=previous and b>a,(a,b,previous)
    previous=b
timeline=json.loads((WORK/'timeline.json').read_text())
duration=timeline[-1]['start']+timeline[-1]['duration']
assert previous<duration and 180<=duration<=240
frames=[]
for i,scene in enumerate(timeline):
    name=WORK/(f'encoded-{scene["id"]}.jpg')
    subprocess.run([FFMPEG,'-v','error','-y','-ss',str(scene['start']+scene['duration']*.65),'-i',str(VIDEO),'-frames:v','1','-q:v','2',str(name)],check=True)
    frames.append(Image.open(name).convert('RGB'))
contact=Image.new('RGB',(1920,math.ceil(len(frames)/4)*298),'#151122')
for i,frame in enumerate(frames):
    contact.paste(frame.resize((480,270)),((i%4)*480,(i//4)*298))
    ImageDraw.Draw(contact).text(((i%4)*480+10,(i//4)*298+274),timeline[i]['id'],font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',16),fill='#eee5ff')
contact.save(OUT/'storyboard.jpg',quality=92)
loudness=subprocess.run([FFMPEG,'-hide_banner','-i',str(VIDEO),'-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True).stderr
measure=json.loads(loudness[loudness.rfind('{'):loudness.rfind('}')+1])
report={'resolution':'1920x1080','fps':24,'durationSeconds':round(duration,3),'sizeMB':round(VIDEO.stat().st_size/1024**2,2),'videoCodec':'H.264','audioCodec':'AAC stereo','decodeErrors':0,'captionCues':len(cues),'overlappingCues':0,'reviewFrames':len(frames),'loudnessLUFS':measure['input_i'],'truePeakDbTP':measure['input_tp']}
(OUT/'verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2),flush=True)
