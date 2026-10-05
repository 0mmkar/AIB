"""Render an edited 1080p product demo from captured application states.

Includes camera moves, cursor emphasis, explanatory motion graphics, timed captions,
generated narration and an original procedural instrumental score. No application data
is fabricated: screen assets are taken by capture.mjs and checked by verify-data.mjs.
"""
import argparse
import bisect
import json
import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from native_cursor import load_cursor

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.demo-tools'))
import imageio_ffmpeg

WORK = ROOT / '.demo-work/v2'
OUT = ROOT / 'deliverables' / 'client-demo-v2'
OUT.mkdir(parents=True, exist_ok=True)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
W, H, FPS, SR = 1920, 1080, 24, 48000
PURPLE = '#a899ff'
TEAL = '#7cdfc1'
WHITE = '#f6f3ff'
MUTED = '#b9b2d3'
SCREEN = (96, 123, 1728, 821)
STORY = json.loads((ROOT / 'scripts/demo/storyboard.json').read_text(encoding='utf8'))
CAPTURE = json.loads((WORK / 'capture.json').read_text())
FONTDIR = Path('C:/Windows/Fonts')
FONTS = {}

def font(size, bold=False):
    key = (size, bold)
    if key not in FONTS:
        FONTS[key] = ImageFont.truetype(str(FONTDIR / ('segoeuib.ttf' if bold else 'segoeui.ttf')), size)
    return FONTS[key]

def smooth(x):
    x = max(0, min(1, x))
    return x*x*(3-2*x)

def text(draw, xy, words, size=30, fill=WHITE, bold=False, anchor=None):
    draw.text(xy, words, font=font(size, bold), fill=fill, anchor=anchor)

def wrap(words, size, max_width, bold=False):
    f = font(size, bold)
    lines, line = [], ''
    for word in words.split():
        next_line = (line + ' ' + word).strip()
        if f.getlength(next_line) > max_width and line:
            lines.append(line); line = word
        else: line = next_line
    if line: lines.append(line)
    return lines

def paragraph(draw, xy, words, size, width, fill=WHITE, bold=False, spacing=1.3):
    x, y = xy
    for line in wrap(words, size, width, bold):
        text(draw, (x,y), line, size, fill, bold)
        y += size*spacing
    return y

def decode(p, tempo=None):
    cmd = [FFMPEG, '-v','error','-i',str(p)]
    if tempo: cmd += ['-af',f'atempo={tempo:.8f}']
    data = subprocess.run(cmd + ['-f','f32le','-ar',str(SR),'-ac','1','pipe:1'], check=True, capture_output=True).stdout
    return np.frombuffer(data, dtype='<f4').copy()

def write_wav(p, data):
    channels = 1 if data.ndim == 1 else data.shape[1]
    with wave.open(str(p),'wb') as output:
        output.setnchannels(channels); output.setsampwidth(2); output.setframerate(SR)
        output.writeframes((np.clip(data, -.999, .999)*32767).astype('<i2').tobytes())

def timestamp(t, separator=','):
    ms = int(round(t*1000)); seconds, ms = divmod(ms,1000)
    minutes, seconds = divmod(seconds,60); hours, minutes = divmod(minutes,60)
    return f'{hours:02}:{minutes:02}:{seconds:02}{separator}{ms:03}'

def prepare_timeline():
    raw = [decode(WORK / 'voice' / (s['id'] + '.mp3')) for s in STORY]
    # A brisk but understandable single pace keeps the complete tour below four minutes.
    lead, tail = .4, .4
    target = 237
    rate = max(1, sum(len(a)/SR for a in raw) / (target-len(STORY)*(lead+tail)))
    timeline, captions, audio = [], [], []
    cursor = 0
    for scene in STORY:
        speech = decode(WORK/'voice'/(scene['id']+'.mp3'), rate)
        peak = max(.001, np.max(np.abs(speech)))
        speech *= min(2.5, .66/peak)
        samples = np.concatenate((np.zeros(round(lead*SR),dtype=np.float32), speech, np.zeros(round(tail*SR),dtype=np.float32)))
        frames = math.ceil(len(samples)/SR*FPS)
        duration = frames/FPS
        samples = np.pad(samples,(0,round(duration*SR)-len(samples)))
        record = {**scene, 'start':cursor, 'duration':duration, 'frames':frames}
        timeline.append(record); audio.append(samples)
        words = json.loads((WORK/'voice'/(scene['id']+'.json')).read_text())
        spoken_tokens = scene['voice'].split()
        if len(spoken_tokens) != len(words):
            raise ValueError('Caption token alignment changed: ' + scene['id'])
        for word, original in zip(words, spoken_tokens):
            word['text'] = original
        group = []
        for index, word in enumerate(words):
            group.append(word)
            letters = sum(len(w['text'])+1 for w in group)
            span = ((word['offset']+word['duration'])-group[0]['offset'])/1e7/rate
            if letters >= 70 or len(group) >= 12 or span >= 4.2 or word['text'].endswith(('.', '?', '!')) or index == len(words)-1:
                start = cursor+lead+group[0]['offset']/1e7/rate
                end = cursor+lead+(group[-1]['offset']+group[-1]['duration'])/1e7/rate
                string = ' '.join(w['text'] for w in group).replace('A I B', 'AIB').replace('S L A', 'SLA')
                captions.append({'start':start,'end':min(cursor+duration-.1,end+.16),'text':string})
                group = []
        cursor += duration
    for index in range(len(captions)-1):
        captions[index]['end'] = min(captions[index]['end'], captions[index+1]['start']-.01)
    previous = 0
    for cue in captions:
        if not previous <= cue['start'] < cue['end'] <= cursor:
            raise ValueError('Invalid caption timing before encode: ' + json.dumps(cue))
        previous = cue['end']
    voice = np.concatenate(audio)
    write_wav(WORK/'narration.wav',voice)
    (WORK/'timeline.json').write_text(json.dumps(timeline,indent=2),encoding='utf8')
    (OUT/'captions.srt').write_text('\n\n'.join(f'{i+1}\n{timestamp(c["start"])} --> {timestamp(c["end"])}\n{c["text"]}' for i,c in enumerate(captions))+'\n',encoding='utf8')
    (OUT/'captions.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{timestamp(c["start"],".")} --> {timestamp(c["end"],".")}\n{c["text"]}' for c in captions)+'\n',encoding='utf8')
    (OUT/'narration.txt').write_text('\n\n'.join(s['title']+'\n'+s['voice'] for s in STORY),encoding='utf8')
    print(f'Timeline: {cursor:.2f} seconds, voice tempo {rate:.3f}, {len(captions)} caption cues',flush=True)
    return timeline,captions,voice,cursor

def score_music(duration, voice):
    """Original restrained D-major ambient score; no sampled or borrowed music."""
    n = len(voice); music = np.zeros((n,2),dtype=np.float32)
    rng = np.random.default_rng(20261001)
    beat = 60/92; bar = beat*4
    chords = [[50,57,61,66,69],[47,54,57,62,66],[43,50,57,59,62],[45,52,57,59,64]]
    def add(sig, start, gain, pan=0):
        offset=int(start*SR)
        if offset >= n:return
        sig=sig[:n-offset]*gain
        music[offset:offset+len(sig),0] += sig*np.sqrt((1-pan)/2)
        music[offset:offset+len(sig),1] += sig*np.sqrt((1+pan)/2)
    def hz(midi):return 440*2**((midi-69)/12)
    for block,start in enumerate(np.arange(0,duration,bar*2)):
        chord=chords[block%4]
        length=bar*2+.65; t=np.arange(int(length*SR),dtype=np.float32)/SR
        envelope=np.minimum(1,t/.8)*np.minimum(1,(length-t)/1.1)
        for j,midi in enumerate(chord[1:]):
            freq=hz(midi)
            sig=(np.sin(2*np.pi*freq*t)+.3*np.sin(2*np.pi*freq*1.002*t)+.15*np.sin(2*np.pi*2*freq*t))*.5
            sig *= envelope*(.85+.15*np.sin(2*np.pi*.13*t+j))
            add(sig,start,.045,(-.5+j/3))
        for k in range(8):
            when=start+k*beat
            t=np.arange(int(2.6*SR),dtype=np.float32)/SR
            note=chord[[2,3,4,3,2,4,3,1][k]]+12
            freq=hz(note)
            sig=(np.sin(2*np.pi*freq*t)+.24*np.sin(2*np.pi*freq*2*t)+.07*np.sin(2*np.pi*freq*3*t))*np.minimum(1,t/.014)*np.exp(-t*2.4)
            add(sig,when,.043,(-.36 if k%2 else .36))
            add(sig,when+beat*.75,.009,(.36 if k%2 else -.36))
        t=np.arange(int(bar*2*SR),dtype=np.float32)/SR
        add(np.sin(2*np.pi*hz(chord[0]-12)*t)*np.minimum(1,t/.07)*np.exp(-t*.5),start,.07)
    for index,start in enumerate(np.arange(bar*2,duration-3,beat)):
        t=np.arange(int(.25*SR),dtype=np.float32)/SR
        if index%2 == 0:
            add(np.sin(2*np.pi*(46*t+4*(1-np.exp(-22*t))))*np.exp(-t*18),start,.035)
        noise=rng.normal(0,1,len(t)).astype(np.float32)
        noise=np.concatenate(([0],np.diff(noise)))
        add(noise*np.exp(-t*65),start+beat/2,.005,(-.4 if index%2 else .4))
    # Smooth attenuation under narration and musical fades at either end.
    chunk=480
    padded=np.pad(voice,(0,(-len(voice))%chunk))
    rms=np.sqrt(np.mean(padded.reshape(-1,chunk)**2,axis=1))
    speaking=np.convolve((rms>.009).astype(float),np.ones(35)/35,mode='same')
    gain=np.interp(np.arange(n)/chunk,np.arange(len(speaking)),.52-.20*speaking)
    fade=np.minimum(1,np.arange(n)/(SR*2.5))*np.minimum(1,(n-np.arange(n))/(SR*4))
    music*= (gain*fade)[:,None]
    write_wav(WORK/'original-music.wav',music)
    mix=voice[:,None]*np.ones((1,2),dtype=np.float32)+music
    mix *= .92/max(.92,float(np.max(np.abs(mix))))
    write_wav(WORK/'mix.wav',mix)
    print('Original instrumental score composed and mixed beneath narration.',flush=True)

def background():
    y,x=np.mgrid[0:H,0:W]
    g=np.exp(-(((x-1550)/850)**2+((y-220)/600)**2))
    h=np.exp(-(((x-100)/700)**2+((y-980)/600)**2))
    array=np.stack([15+17*g+3*h,13+12*g+4*h,29+35*g+12*h],axis=-1).astype('uint8')
    return Image.fromarray(array)

BG=background()
MASK=Image.new('L',(SCREEN[2],SCREEN[3]),0)
ImageDraw.Draw(MASK).rounded_rectangle((0,0,SCREEN[2]-1,SCREEN[3]-1),radius=18,fill=255)
SOURCES={}
CURSORS={'arrow':load_cursor('aero_arrow.cur'), 'hand':load_cursor('aero_link.cur')}

def get_image(name):
    if name not in SOURCES:SOURCES[name]=Image.open(WORK/'shots'/(name+'.png')).convert('RGB')
    return SOURCES[name]

def shot_view(shot, t, duration):
    source=get_image(shot['name']); sw,sh=source.size
    # Establish context first, then move smoothly towards the point of attention.
    # Wide prose must remain complete; emphasise its container without cutting words.
    wide_text = shot['name'] in ['narrative','drivers','scope','backlog','ask-typed','ask-answer','pack-print']
    desired_zoom = 1.02 if wide_text else shot.get('zoom',1.12)
    zoom=1+(desired_zoom-1)*smooth(t/2.8)
    cx,cy=shot.get('focus',[.5,.5]); cw,ch=sw/zoom,sh/zoom
    if wide_text:cx=.5
    left=max(0,min(sw-cw,cx*sw-cw/2)); top=max(0,min(sh-ch,cy*sh-ch/2))
    view=source.resize((SCREEN[2],SCREEN[3]),Image.Resampling.BICUBIC,box=(left,top,left+cw,top+ch))
    if shot.get('click'):
        target=CAPTURE[shot['name']]['target']
        if target:
            # Native Windows artwork and its actual hotspot keep targeting realistic.
            px=(target['x']+target['w']/2)*1.5; py=(target['y']+target['h']/2)*1.5
            dx=(px-left)/cw*SCREEN[2]; dy=(py-top)/ch*SCREEN[3]
            d=ImageDraw.Draw(view,'RGBA')
            click_time=max(1.25,duration-.22)
            move_start=max(.3,click_time-1.5)
            progress=smooth((t-move_start)/1.0)
            start_x=min(SCREEN[2]-45,dx+85)
            start_y=min(SCREEN[3]-45,dy+55)
            x=start_x+(dx-start_x)*progress
            y=start_y+(dy-start_y)*progress-7*math.sin(math.pi*progress)
            if 0 < t-click_time < .45:
                pulse=(t-click_time)/.45
                r=5+14*pulse
                opacity=int(150*(1-pulse))
                d.ellipse((x-r,y-r,x+r,y+r),outline=(160,143,250,opacity),width=2)
            if t>=move_start:
                kind='hand' if progress>.92 and target.get('cursor')=='pointer' else 'arrow'
                sprite,hotspot=CURSORS[kind]
                view.paste(sprite,(round(x-hotspot[0]),round(y-hotspot[1])),sprite)
    return view

def app_scene(scene, local):
    frame=BG.copy(); d=ImageDraw.Draw(frame)
    text(d,(96,24),'AIB LIFE  /  SERVICE GOVERNANCE',19,PURPLE,True)
    text(d,(96,55),scene['title'],34,WHITE,True)
    text(d,(1824,42),scene['chapter'].upper(),17,MUTED,True,anchor='ra')
    shots=scene['shots']; segment=scene['duration']/len(shots)
    index=min(len(shots)-1,int(local/segment)); elapsed=local-index*segment
    view=shot_view(shots[index],elapsed,segment)
    transition=.40
    if index>0 and elapsed<transition:
        previous=shot_view(shots[index-1],segment,segment)
        view=Image.blend(previous,view,smooth(elapsed/transition))
    d.rounded_rectangle((SCREEN[0]-2,SCREEN[1]-2,SCREEN[0]+SCREEN[2]+2,SCREEN[1]+SCREEN[3]+2),radius=20,fill='#5b5079')
    frame.paste(view,(SCREEN[0],SCREEN[1]),MASK)
    return frame

def title_scene(scene, local):
    frame=BG.copy(); d=ImageDraw.Draw(frame,'RGBA')
    progress=smooth(local/1.3)
    for index,radius in enumerate([330,430,540]):
        x=1510+math.sin(local*.12)*20; y=410
        d.ellipse((x-radius,y-radius,x+radius,y+radius),outline=(155,133,248,35),width=2)
    d.rounded_rectangle((116,119,285,160),radius=20,fill=(155,133,248,30))
    text(d,(138,126),'AIB LIFE',21,PURPLE,True)
    text(d,(117,204),'SCHEDULE 23  /  PRODUCT WALKTHROUGH',22,MUTED,True)
    if scene['type']=='closing':
        lines=['Evidence.','Understanding.','Accountability.']
        sub='Prepare  →  Review  →  Investigate  →  Share'
    else:
        lines=['Every service level.','One clear story.']
        sub='From data sources to monthly governance'
    y=306+22*(1-progress)
    for line in lines:
        text(d,(111,y),line,76,PURPLE if line==lines[-1] else WHITE,True)
        y+=101
    text(d,(117,y+38),sub,30,MUTED)
    card_y=354
    for i,(number,label) in enumerate([('05','DATA SOURCES'),('22','REPORTING MONTHS'),('01','CONNECTED JOURNEY')]):
        xx=1420+15*math.sin(local*.16+i)
        d.rounded_rectangle((xx,card_y+i*150,xx+332,card_y+124+i*150),radius=22,fill=(51,40,85,230),outline=(105,87,162,110),width=1)
        text(d,(xx+26,card_y+15+i*150),number,47,TEAL,True)
        text(d,(xx+110,card_y+49+i*150),label,17,MUTED,True)
    text(d,(117,852),'DATA SOURCE SNAPSHOT / 24 SEPTEMBER 2026',19,MUTED)
    return frame

def flow_scene(scene,local):
    frame=BG.copy();d=ImageDraw.Draw(frame,'RGBA')
    text(d,(96,75),'THE USER JOURNEY',22,PURPLE,True)
    text(d,(96,137),scene['title'],62,WHITE,True)
    steps=[('01','Prepare','Upload and validate\nthe data sources'),('02','Review','Measure performance\nagainst Schedule 23'),('03','Investigate','Trace exceptions\nto their records'),('04','Share','Build the monthly\ngovernance pack')]
    for i,(number,title,copy) in enumerate(steps):
        x=96+i*444;y=352+24*(1-smooth((local-i*.4)/.8))
        active=min(3,int(local/(scene['duration']/4)))
        d.rounded_rectangle((x,y,x+396,y+344),radius=24,fill=(37,31,62,255),outline=PURPLE if i==active else '#44395f',width=3 if i==active else 1)
        text(d,(x+30,y+28),number,44,TEAL,True)
        text(d,(x+30,y+111),title,36,WHITE,True)
        for k,line in enumerate(copy.split('\n')):text(d,(x+30,y+184+k*40),line,26,MUTED)
        if i<3:text(d,(x+407,y+144),'→',31,PURPLE)
    text(d,(96,790),'Five data sources  →  deterministic rules  →  a pack for every reporting month',29,MUTED)
    return frame

def rates_scene(scene,local):
    frame=BG.copy(); d=ImageDraw.Draw(frame,'RGBA')
    text(d,(96,75),'UNDERSTAND THE VERDICT',22,PURPLE,True)
    text(d,(96,137),scene['title'],61,WHITE,True)
    cards=[(96,PURPLE,'RATE (COMPLETED)','Met','Met + missed','Determines PASS or FAIL'),(996,TEAL,'RATE INCLUDING OPEN','Met','Met + missed + overdue open','Makes overdue obligations visible')]
    for x,col,label,top,bottom,note in cards:
        d.rounded_rectangle((x,325,x+828,756),radius=26,fill=(38,31,62,255),outline=col,width=2)
        text(d,(x+38,364),label,22,col,True)
        text(d,(x+414,444),top,49,WHITE,True,anchor='ma')
        d.line((x+69,520,x+759,520),fill='#7c6c9e',width=2)
        text(d,(x+414,550),bottom,35,WHITE,True,anchor='ma')
        text(d,(x+38,679),note,27,col)
    text(d,(96,823),'Policies counted per service record. Completed and unfinished work in view.',29,MUTED)
    return frame

def render_visual(scene,local):
    if scene.get('type') in ['title','closing']:return title_scene(scene,local)
    if scene.get('type')=='flow':return flow_scene(scene,local)
    if scene.get('type')=='rates':return rates_scene(scene,local)
    return app_scene(scene,local)

def caption_on(frame,caption):
    if not caption:return
    d=ImageDraw.Draw(frame,'RGBA')
    lines=wrap(caption,29,1550,False)
    height=40*len(lines)+20
    y=H-33-height
    max_width=max(font(29).getlength(line) for line in lines)
    d.rounded_rectangle(((W-max_width)/2-26,y-4,(W+max_width)/2+26,y+height),radius=13,fill=(12,10,24,244))
    for i,line in enumerate(lines):text(d,(W/2,y+7+i*40),line,29,WHITE,anchor='ma')

def render(timeline,captions,duration,preview=False):
    starts=[s['start'] for s in timeline]; cue_starts=[c['start'] for c in captions]
    def frame_at(t):
        index=max(0,bisect.bisect_right(starts,t)-1)
        scene=timeline[index];local=t-scene['start']
        frame=render_visual(scene,local)
        if index>0 and local<.36:
            prior=timeline[index-1]
            previous=render_visual(prior,prior['duration']-.001)
            frame=Image.blend(previous,frame,smooth(local/.36))
        cue_index=bisect.bisect_right(cue_starts,t)-1
        caption=captions[cue_index]['text'] if cue_index>=0 and t<captions[cue_index]['end'] else ''
        caption_on(frame,caption)
        d=ImageDraw.Draw(frame)
        d.rectangle((0,H-5,W,H),fill='#39314e')
        d.rectangle((0,H-5,int(W*t/duration),H),fill=PURPLE)
        fade=min(1,t/.6,(duration-t)/.8)
        if fade<1:frame=Image.blend(Image.new('RGB',(W,H),'#0e0c1a'),frame,max(0,fade))
        return frame
    # Contact sheet makes editorial checks quick before committing to full encoding.
    contact=Image.new('RGB',(4*480,math.ceil(len(timeline)/4)*298),'#151122')
    for i,s in enumerate(timeline):
        frame=frame_at(s['start']+s['duration']*.60)
        frame.save(WORK/(f'preview-{s["id"]}.jpg'),quality=92)
        contact.paste(frame.resize((480,270)),((i%4)*480,(i//4)*298))
        ImageDraw.Draw(contact).text(((i%4)*480+10,(i//4)*298+274),s['id'],font=font(16),fill=WHITE)
    contact.save(OUT/'storyboard.jpg',quality=92)
    frame_at(2.6).save(OUT/'poster.jpg',quality=95)
    if preview:return
    total=round(duration*FPS)
    cmd=[FFMPEG,'-hide_banner','-loglevel','warning','-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-i',str(WORK/'mix.wav'),'-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-shortest',str(OUT/'AIB-Life-Application-Demo.mp4')]
    with (WORK/'encode.log').open('w') as log:
        process=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
        for i in range(total):
            process.stdin.write(frame_at(i/FPS).tobytes())
            if i%(FPS*10)==0:print(f'Encoded {i/FPS:.0f}s / {duration:.0f}s',flush=True)
        process.stdin.close()
        if process.wait()!=0:raise RuntimeError('FFmpeg encode failed; see .demo-work/encode.log')
    print('Video complete: '+str(OUT/'AIB-Life-Application-Demo.mp4'),flush=True)

def write_info(timeline,duration):
    chapters=[]
    for s in timeline:
        if not chapters or chapters[-1]['name'] != s['chapter']:chapters.append({'name':s['chapter'],'time':s['start']})
    (OUT/'chapters.json').write_text(json.dumps(chapters,indent=2))
    (OUT/'production-notes.txt').write_text(
        'AIB LIFE APPLICATION DEMO\n\n'
        f'Format: 1920 x 1080, {FPS} fps, H.264 video with AAC stereo audio.\nDuration: {duration:.2f} seconds.\n\n'
        'The screen imagery was captured from the actual application. Zooms, cursor cues and transitions are editorial effects applied to captured interaction states.\n'
        'The five input files were verified byte-for-byte against the current application dataset. Results, item records, quality findings and failure groups matched across all 22 months, with zero differences.\n'
        'Upload and rebuild actions used an isolated copy to preserve the original stored reports. Capture timestamps therefore reflect the recording session.\n'
        'Narration: generated locally with Microsoft Zira Desktop through Windows System.Speech. No narration text was sent to an external voice service. No cloned voice.\n'
        'Music: original instrumental score synthesised by scripts/demo/render.py; no third-party music recordings or samples.\n'
        'The narrative and Q&A shown returned Amazon Nova Pro responses through the configured Bedrock connection, verified from the application source labels. Existing report-only guards and fallback remain part of the application.\n'
        'Pointer artwork: native Windows aero_arrow.cur and aero_link.cur, with their original alpha channel and hotspots; movement and small click rings are editorial overlays.\n'
        'PDF output is illustrated with the real print-rendered document; the operating-system print dialog is not recorded.\n\n'
        'Files: MP4 master; caption sidecars (SRT and WebVTT); voice script; preview poster; storyboard contact sheet; local HTML player.\n'
        'Recreate with capture.mjs and verify-data.mjs; generate speech with voice-local.ps1; package with voice.py --reuse-wav; render with render.py; verify with verify-video.py --normalise and check-player.mjs. All scripts are in scripts/demo. Python packages: Pillow, numpy, imageio-ffmpeg. Windows System.Speech supplies offline narration.\n',encoding='utf8')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preview',action='store_true');args=parser.parse_args()
    timeline,captions,voice,duration=prepare_timeline()
    score_music(duration,voice)
    write_info(timeline,duration)
    render(timeline,captions,duration,args.preview)
