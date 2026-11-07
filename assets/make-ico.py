import os
HERE = os.path.dirname(os.path.abspath(__file__))
from PIL import Image
src = Image.open(os.path.join(HERE, "icon.png")).convert("RGBA")
sizes = [(16,16),(20,20),(24,24),(32,32),(40,40),(48,48),(64,64)]
src.save(os.path.join(HERE, "icon.ico"), sizes=sizes)
print("ico written")
