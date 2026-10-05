"""Read the installed Windows cursor artwork, preserving alpha and click hotspots."""
import io
import struct
from pathlib import Path
from PIL import Image

def load_cursor(name, size=32):
    data = (Path('C:/Windows/Cursors') / name).read_bytes()
    reserved, kind, count = struct.unpack_from('<HHH', data)
    if reserved or kind != 2:
        raise ValueError('Expected Windows CUR resource')
    entries = [struct.unpack_from('<BBBBHHII', data, 6+i*16) for i in range(count)]
    entry = min(entries, key=lambda e: abs((e[0] or 256)-size))
    w, h, colors, reserved, hx, hy, length, offset = entry
    # Pillow's CUR reader loses alpha. Its ICO reader preserves the same DIB payload.
    ico = (struct.pack('<HHH', 0, 1, 1)
           + struct.pack('<BBBBHHII', w, h, colors, reserved, 1, 32, length, 22)
           + data[offset:offset+length])
    source = Image.open(io.BytesIO(ico)).convert('RGBA')
    scale = size/source.width
    return source.resize((size, size), Image.Resampling.LANCZOS), (round(hx*scale), round(hy*scale))
