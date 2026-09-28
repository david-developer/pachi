#!/usr/bin/env python3
"""Restore only the synthetic pachi_test database into a disposable, offline container.

Requires the existing Docker test service and its locally available PostGIS image.
Private dump/evidence files stay outside Git. Never targets pachi_local.
"""
import os,subprocess,json,time,hashlib
from pathlib import Path
os.umask(0o077)
source='pachi-postgres-test-1';meta=json.loads(subprocess.check_output(['docker','inspect',source]))[0]
env=dict(x.split('=',1) for x in meta['Config']['Env'] if '=' in x)
assert env['POSTGRES_DB']=='pachi_test' and meta['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']=='5433'
root=Path.home()/'.local/share/pachi/g1-restore';root.mkdir(parents=True,exist_ok=True)
started=time.time();name='pachi-g1-restore-'+str(int(started));dump=root/(name+'.dump')
def run(args,**kw):return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kw)
def sql(container,query):
 r=run(['docker','exec','-i',container,'sh','-c','exec psql -X -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d '+('\"$POSTGRES_DB\"' if container==source else 'pachi_restore')],input=query.encode());return r.stdout.decode().strip()
def manifest(container):
 names=json.loads(sql(container,"SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public';"))
 rows={}
 for table in names:
  ident='"'+table.replace('"','""')+'"'
  rows[table]=sql(container,"SELECT count(*)::text || ':' || coalesce(md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)),'empty') FROM public."+ident+' t;')
 return {'tables':rows,'extensions':sql(container,'SELECT json_agg(extname ORDER BY extname) FROM pg_extension;'),'constraints':sql(container,"SELECT count(*)||':'||count(*) FILTER(WHERE NOT convalidated) FROM pg_constraint WHERE connamespace='public'::regnamespace;"),'invalidIndexes':sql(container,"SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relnamespace='public'::regnamespace AND NOT i.indisvalid;")}
created=False
try:
 before=manifest(source)
 with dump.open('wb') as f:
  r=subprocess.run(['docker','exec',source,'sh','-c','exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges'],stdout=f,stderr=subprocess.PIPE,check=True)
 run(['docker','run','-d','--name',name,'--network','none','--label','pachi.purpose=g1-isolated-restore','-e','POSTGRES_DB=restore_bootstrap','-e','POSTGRES_USER=pachi_restore','-e','POSTGRES_HOST_AUTH_METHOD=trust',meta['Image'],'postgres','-c','listen_addresses='])
 created=True
 for _ in range(60):
  r=subprocess.run(['docker','exec',name,'pg_isready','-U','pachi_restore','-d','restore_bootstrap'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if r.returncode==0 and subprocess.check_output(['docker','exec',name,'cat','/proc/1/comm']).decode().strip()=='postgres':break
  time.sleep(.25)
 run(['docker','exec',name,'createdb','-U','pachi_restore','-T','template0','pachi_restore'])
 with dump.open('rb') as f:run(['docker','exec','-i',name,'pg_restore','-U','pachi_restore','-d','pachi_restore','--no-owner','--no-privileges','--exit-on-error'],stdin=f)
 after=manifest(name);source_after=manifest(source)
 assert before==after,'Restore manifest mismatch'
 assert before==source_after,'Source changed during restore'
 evidence={'source':'localhost:5433/pachi_test','isolatedTarget':name+'/pachi_restore','network':'none; no published ports; unix socket only','tableCount':len(before['tables']),'allTableCountsAndRowHashesMatch':True,'extensionsMatch':True,'constraintsMatch':True,'invalidIndexes':after['invalidIndexes'],'sourceUnchanged':True,'elapsedSeconds':round(time.time()-started,2),'dumpSha256':hashlib.sha256(dump.read_bytes()).hexdigest(),'dumpFile':str(dump)}
 (root/(name+'.json')).write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
except subprocess.CalledProcessError as e:print('Restore command failed; exit',e.returncode,'operation',next((x for x in e.cmd if x in ['pg_restore','run','psql','pg_dump']), 'docker-exec'));print('Safe error lines:',[line for line in (e.stderr or b'').decode(errors='replace').splitlines() if line.startswith(('pg_restore: error:', 'ERROR:', 'psql: error:'))][:4]);raise SystemExit(1)
finally:
 if created:run(['docker','rm','-f','-v',name]);print('Only isolated restore container and its anonymous volumes removed; source preserved.')
