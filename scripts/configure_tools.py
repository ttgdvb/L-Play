import json
import os
import sys
from pathlib import Path
import imageio_ffmpeg

root = Path(__file__).resolve().parents[1]
(root / '.runtime' / 'config.json').write_text(json.dumps({
    'python': sys.executable,
    'pythonPath': os.environ['PYTHONPATH'],
    'ffmpeg': imageio_ffmpeg.get_ffmpeg_exe(),
}, ensure_ascii=False), encoding='utf-8')
