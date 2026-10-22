import json, os, re
MCP=r'D:\workplace\mcp-server'
OLD=os.path.join(os.environ['TEMP'],'sango-rebase','old-corpus','sango','data','corpus','sanguo-yanyi')
VARIANTS=str.maketrans({'馀':'余','邰':'郃','毌':'毋','麴':'麹','祎':'袆','顒':'颙'})
NON=re.compile(r'[^0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff]')
def norm(s): return NON.sub('',s).translate(VARIANTS)
def load(root):
    out=[]
    for h in range(1,121):
        d=json.load(open(os.path.join(root,'%03d.json'%h),encoding='utf-8'))
        out.extend(c['text'] for c in d['chunks'])
    return norm('\n'.join(out))
old=load(OLD); new=load(os.path.join(MCP,'sango/data/corpus/sanguo-yanyi'))
table=json.load(open(os.path.join(MCP,'sango/data/entity-table.json'),encoding='utf-8'))
print('old chars',len(old),'new chars',len(new))
n=0
for row in table['rows']:
    words=[('canonical',row['canonical'])]+[('aliases',w) for w in row.get('aliases',[])]+[('rewriteKeys',w) for w in row.get('rewriteKeys',[])]
    for f,w in words:
        nw=norm(w)
        if nw and nw in old and nw not in new:
            n+=1
            print('%s\t%s\t%s\t%s\t%s' % (row.get('id') or '-', row['type'], row['canonical'], f, w))
print('regressions',n)
