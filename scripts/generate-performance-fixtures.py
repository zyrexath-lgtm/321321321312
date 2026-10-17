#!/usr/bin/env python3
"""Generate real DOCX files with 1,000 body paragraphs and a valid noisy PNG.
Uses Pillow only for this optional benchmark, never in the web application.
"""
import argparse, io, json, random, zipfile
from pathlib import Path
from PIL import Image

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P='http://schemas.openxmlformats.org/package/2006/relationships'
parser=argparse.ArgumentParser()
parser.add_argument('--out',default='/tmp/norma-performance-fixtures')
args=parser.parse_args()
out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
paragraph='<w:p><w:r><w:t>Проверяем оформление большого документа. Text, Unicode Ω, неразрывный\u00a0пробел и мягкий\u00adперенос сохраняются.</w:t></w:r></w:p>'
drawing='<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Noise test image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
manifest=[]
for mib in [1,5,10,19.9]:
 target=int(mib*1024*1024)
 height=max(1,(target-16384)//(1024*3))
 pixels=random.Random(321).randbytes(1024*height*3)
 image=Image.frombytes('RGB',(1024,height),pixels)
 encoded=io.BytesIO();image.save(encoded,format='PNG',compress_level=1)
 parts={
 '[Content_Types].xml':f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
 '_rels/.rels':f'<Relationships xmlns="{P}"><Relationship Id="rIdDoc" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':f'<Relationships xmlns="{P}"><Relationship Id="rIdStyles" Type="{R}/styles" Target="styles.xml"/><Relationship Id="rIdImage" Type="{R}/image" Target="media/image.png"/></Relationships>',
 'word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
 'word/document.xml':f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>{paragraph*1000}{drawing}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
 'word/media/image.png':encoded.getvalue(),
 }
 name=f'performance-{mib:g}mib.docx';path=out/name
 with zipfile.ZipFile(path,'w') as z:
  for part,data in parts.items():
   z.writestr(part,data,compress_type=zipfile.ZIP_STORED if part.endswith('.png') else zipfile.ZIP_DEFLATED)
 assert path.stat().st_size<=20*1024*1024
 manifest.append({'file':str(path),'bytes':path.stat().st_size,'targetMiB':mib,'paragraphs':1000})
(out/'manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps(manifest,indent=2))
