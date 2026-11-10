"""Official, pinned Windows development packages; optional fallback when Docker registry access fails."""
from pathlib import Path
import concurrent.futures, hashlib, math, re, time, urllib.request

root=Path(__file__).resolve().parents[1]/'.data/services/downloads'
root.mkdir(parents=True,exist_ok=True)
packages=[
 ('elasticsearch-8.19.0-windows-x86_64.zip','https://artifacts.elastic.co/downloads/elasticsearch/elasticsearch-8.19.0-windows-x86_64.zip',498056671,'67557764ea6e3ddcb4d57cf80a166770612749938365b72af724ca6947a6d9e8a9ede3e3b81809812336359b03442cb4e670cf4c2ca9be78b7c6c4bc365836c1'),
 ('kafka_2.13-3.9.1.tgz','https://archive.apache.org/dist/kafka/3.9.1/kafka_2.13-3.9.1.tgz',122110298,'1ea204ba73411737a275429ca976d440f007ff0957b90b19be41dc5a4bae52617267769be9f0b5791714d0b3c4c760605bd426faea39edd90763585523fa2cfe'),
 ('analysis-ik-8.19.0.zip','https://get.infini.cloud/elasticsearch/analysis-ik/8.19.0',4618740,'287677c1a2a5a19f0363455890d5c882b8679e92255149acadb84c8f208565f545e77153239f404a451ae63aa90b83c7b0bb000ffca87fdffc0c08fbfd4b3539'),
]
size=4*1024*1024
for name,url,total,digest in packages:
    target=root/name
    if target.exists():
        with target.open('rb') as source:
            if hashlib.file_digest(source,'sha512').hexdigest()==digest:
                print(f'Already verified: {name}',flush=True)
                continue
    def fetch(i):
        start=i*size;end=min(total-1,start+size-1);part=root/(name+f'.chunk{i}')
        if part.exists() and part.stat().st_size==end-start+1:return
        for attempt in range(4):
            try:
                request=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}'})
                with urllib.request.urlopen(request,timeout=45) as response:
                    if response.status!=206 or response.headers.get('Content-Range')!=f'bytes {start}-{end}/{total}':raise RuntimeError('Unexpected package range')
                    data=response.read(end-start+1)
                if len(data)!=end-start+1:raise RuntimeError('Incomplete package range')
                part.write_bytes(data)
                return
            except Exception:
                if attempt==3:raise
                time.sleep(attempt+1)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for completed,_ in enumerate(pool.map(fetch,range(math.ceil(total/size))),1):
            if completed%16==0:print(f'{name}: {completed} ranges',flush=True)
    temporary=root/(name+'.assembling')
    with temporary.open('wb') as output:
        for i in range(math.ceil(total/size)):output.write((root/(name+f'.chunk{i}')).read_bytes())
    with temporary.open('rb') as source:
        if hashlib.file_digest(source,'sha512').hexdigest()!=digest:raise RuntimeError(f'Pinned SHA512 mismatch: {name}')
    temporary.replace(target)
    print(f'Downloaded and verified: {name}',flush=True)
