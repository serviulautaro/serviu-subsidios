import os,mimetypes,unicodedata
from pathlib import Path
from supabase import create_client

URL="https://qirjfgjesjzikouehmib.supabase.co"
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcmpmZ2plc2p6aWtvdWVobWliIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzY2ODExNSwiZXhwIjoyMDkzMjQ0MTE1fQ.c0e2EkhXL_nUY92oKzx2xEQVQrIYLhIuAWEh-HSBhME"
BUCKET="documentos-solicitantes"
RESPALDO=r"C:\Users\JORGE\Desktop\Respaldo de documentos"

sb=create_client(URL,KEY)

def norm(n):
    n=unicodedata.normalize("NFD",str(n))
    n="".join(c for c in n if unicodedata.category(c)!="Mn")
    return "".join(c for c in n.replace(" ","_") if c.isalnum() or c in "_-.").strip("_")[:90]

def subir(r,sp):
    mime=mimetypes.guess_type(str(r))[0] or "application/octet-stream"
    try:
        sb.storage.from_(BUCKET).upload(sp,open(r,"rb").read(),file_options={"content-type":mime,"upsert":"true"})
        return True
    except Exception as e:
        print(f"  ERR {r.name}: {e}")
        return False

t=e=0
for prog in Path(RESPALDO).iterdir():
    if not prog.is_dir():continue
    print(f"\nPrograma: {prog.name}")
    for sub in prog.iterdir():
        if not sub.is_dir():continue
        hijos=[x for x in sub.iterdir() if x.is_dir()]
        if hijos:
            cn=norm(sub.name)
            for p in hijos:
                pn=norm(p.name)
                for a in p.iterdir():
                    if a.is_file():
                        if subir(a,f"{cn}/{pn}/{norm(a.name)}"):t+=1
                        else:e+=1
        else:
            pn=norm(sub.name)
            for a in sub.iterdir():
                if a.is_file():
                    if subir(a,f"{norm(prog.name)}/{pn}/{norm(a.name)}"):t+=1
                    else:e+=1
        if t%20==0 and t>0:print(f"  {t} subidos...")
print(f"\nListo: {t} subidos, {e} errores")
