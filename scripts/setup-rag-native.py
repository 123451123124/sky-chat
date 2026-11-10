"""Optional Windows fallback using official packages already downloaded into .data/services/downloads."""
from pathlib import Path
import hashlib, json, re, shutil, tarfile, urllib.request, zipfile, time

root = Path(__file__).resolve().parents[1]
services = root / '.data/services'
downloads = services / 'downloads'
runtime = services / 'runtime'
runtime.mkdir(parents=True, exist_ok=True)
packages = [
 ('elasticsearch-8.19.0-windows-x86_64.zip', 'https://artifacts.elastic.co/downloads/elasticsearch/elasticsearch-8.19.0-windows-x86_64.zip.sha512'),
 ('kafka_2.13-3.9.1.tgz', 'https://archive.apache.org/dist/kafka/3.9.1/kafka_2.13-3.9.1.tgz.sha512'),
]
evidence=[]
for name,url in packages:
    archive=downloads/name
    if (downloads/(name+'.ready')).exists():archive=downloads/(name+'.ready')
    for _ in range(180):
        if archive.exists():break
        time.sleep(2)
    with urllib.request.urlopen(url,timeout=30) as response:
        digest_text=response.read().decode()
        if ': ' in digest_text: digest_text=digest_text.split(': ',1)[1]
        expected=re.search(r'[a-fA-F0-9]{128}',re.sub(r'\s+','',digest_text)).group(0).lower()
    with archive.open('rb') as source:
        actual=hashlib.file_digest(source,'sha512').hexdigest()
    if actual!=expected: raise RuntimeError(f'Official SHA512 mismatch: {name}')
    evidence.append({'file':name,'sha512':actual,'verifiedAgainst':url})
    target=runtime/('elasticsearch-8.19.0' if name.endswith('.zip') else 'kafka_2.13-3.9.1')
    if not target.exists():
        if name.endswith('.zip'):
            with zipfile.ZipFile(archive) as source:
                if any(not (runtime/p).resolve().is_relative_to(runtime.resolve()) for p in source.namelist()): raise RuntimeError('Invalid ZIP entry')
                source.extractall(runtime)
        else:
            with tarfile.open(archive) as source: source.extractall(runtime,filter='data')
    print(f'Verified and extracted {name}',flush=True)
es=runtime/'elasticsearch-8.19.0'
plugin=es/'plugins/analysis-ik'
with (downloads/'analysis-ik-8.19.0.zip').open('rb') as source:
    ik_digest=hashlib.file_digest(source,'sha512').hexdigest()
if ik_digest!='287677c1a2a5a19f0363455890d5c882b8679e92255149acadb84c8f208565f545e77153239f404a451ae63aa90b83c7b0bb000ffca87fdffc0c08fbfd4b3539':raise RuntimeError('Pinned IK SHA512 mismatch')
evidence.append({'file':'analysis-ik-8.19.0.zip','sha512':ik_digest,'verifiedAgainst':'Pinned digest in scripts/download-rag-native.py; official HTTPS release and plugin descriptor'})
with zipfile.ZipFile(downloads/'analysis-ik-8.19.0.zip') as source:
    descriptor=source.read('plugin-descriptor.properties').decode()
    if 'elasticsearch.version=8.19.0' not in descriptor:raise RuntimeError('IK version mismatch')
    source.extractall(plugin)
shutil.copytree(plugin/'config',es/'config/analysis-ik',dirs_exist_ok=True)
shutil.copy(root/'infra/elasticsearch/sky-chat.dic',es/'config/analysis-ik/sky-chat.dic')
cfg=es/'config/analysis-ik/IKAnalyzer.cfg.xml'
cfg.write_text(re.sub(r'(<entry key="ext_dict">).*?(</entry>)',r'\1sky-chat.dic\2',cfg.read_text(encoding='utf-8')),encoding='utf-8')
config={'cluster.name':'sky-chat-rag-local','node.name':'sky-chat-es','network.host':'127.0.0.1','http.port':19200,'transport.port':19300,'discovery.type':'single-node','xpack.security.enabled':False,'xpack.ml.enabled':False,'cluster.routing.allocation.disk.watermark.low':'10gb','cluster.routing.allocation.disk.watermark.high':'5gb','cluster.routing.allocation.disk.watermark.flood_stage':'2gb','path.data':(services/'es-data').as_posix(),'path.logs':(services/'es-logs').as_posix()}
(es/'config/elasticsearch.yml').write_text('\n'.join(f'{k}: {json.dumps(v,ensure_ascii=False)}' for k,v in config.items())+'\n',encoding='utf-8')
(es/'config/jvm.options.d/sky-chat.options').write_text('-Xms512m\n-Xmx512m\n',encoding='utf-8')
settings={'process.roles':'broker,controller','node.id':'1','controller.quorum.voters':'1@127.0.0.1:19093','listeners':'PLAINTEXT://127.0.0.1:19092,CONTROLLER://127.0.0.1:19093','advertised.listeners':'PLAINTEXT://127.0.0.1:19092','controller.listener.names':'CONTROLLER','listener.security.protocol.map':'PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT','inter.broker.listener.name':'PLAINTEXT','log.dirs':(services/'kafka-data').as_posix(),'offsets.topic.replication.factor':'1','transaction.state.log.replication.factor':'1','transaction.state.log.min.isr':'1','group.initial.rebalance.delay.ms':'0','num.partitions':'3','log.retention.hours':'168'}
properties='\n'.join(f'{k}={v}' for k,v in settings.items())+'\n'
(services/'kafka.properties').write_text(''.join(c if ord(c)<128 else f'\\u{ord(c):04x}' for c in properties),encoding='ascii')
(root/'reports/rag-native-artifacts.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
print('Local-only native service configuration ready',flush=True)
