import uuid
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from app.main import app
from test_info_requests import opened,login,base,post,create_request

LIMIT=5*1024*1024


def upload(client,item,r,content='Синтетическая справка'.encode(),filename='Справка.txt',kind='text/plain',fid=None,revision=None):
    fid=fid or str(uuid.uuid4())
    path=base(item)+'/'+r['id']+'/attachments/'+fid
    return client.put(path,params={'filename':filename,'revision':revision or r['revision']},content=content,headers={'Content-Type':kind}),path


def test_document_requirement_persistence_download_and_close(client):
    item,r=opened(client,True);login(client);path=base(item)+'/'+r['id']
    item=client.patch(path+'/reply',json={'revision':1,'reply_text':'Сведения и справка'}).json();r=item['info_requests'][0]
    assert post(client,path+'/reply/submit',{'version':item['version'],'revision':r['revision']}).status_code==422
    data='Синтетические данные'.encode()
    response,filepath=upload(client,item,r,data)
    assert response.status_code==200,response.text
    item=response.json();r=item['info_requests'][0];metadata=r['attachments'][0]
    assert metadata['size_bytes']==len(data) and 'content' not in metadata and 'sha256' not in metadata
    downloaded=client.get(filepath)
    assert downloaded.content==data and downloaded.headers['x-content-type-options']=='nosniff'
    assert "filename*=UTF-8''" in downloaded.headers['content-disposition']
    closed=post(client,path+'/reply/submit',{'version':item['version'],'revision':r['revision']})
    assert closed.status_code==200
    assert upload(client,item,r)[0].status_code==409
    assert upload(client,item,r,data,fid=metadata['id'])[0].json()==closed.json()
    with TestClient(app) as fresh:
        login(fresh,'staff')
        assert fresh.get(filepath.replace('/applications/','/staff/applications/')).content==data


@pytest.mark.parametrize('data,name,kind,status',[
    (b'', 'x.txt','text/plain',415), (b'fake','x.pdf','application/pdf',415),
    (b'%PDF-1.7\nsynthetic','x.pdf','text/plain',415), (b'abc','x.txt','image/png',415),
    (b'\xff','x.txt','text/plain',415), (b'a\0b','x.txt','text/plain',415),
    (b'abc','../x.txt','text/plain',422), (b'abc','x\r\n.txt','text/plain',422),
    (b'a'*(LIMIT+1),'x.txt','text/plain',413),
])
def test_invalid_file_is_atomic(client,data,name,kind,status):
    item,r=opened(client);login(client)
    response,_=upload(client,item,r,data,name,kind)
    assert response.status_code==status,response.text
    current=client.get('/api/v1/applications/'+item['id']).json()
    assert current==item


def test_limits_streaming_pdf_and_slots(client):
    item,r=opened(client);login(client)
    response,_=upload(client,item,r,iter([b'a'*LIMIT]),'large.txt')
    assert response.status_code==200,response.text
    item=response.json();r=item['info_requests'][0]
    response,_=upload(client,item,r,iter([b'%PDF-1.7\n',b'synthetic']),'x.PDF','application/pdf')
    assert response.status_code==200,response.text
    item=response.json();r=item['info_requests'][0]
    for i in range(3):
        response,_=upload(client,item,r,b'a',str(i)+'.txt');assert response.status_code==200
        item=response.json();r=item['info_requests'][0]
    assert upload(client,item,r,b'a','sixth.txt')[0].status_code==422
    assert upload(client,item,r,iter([b'a'*LIMIT,b'b']))[0].status_code==413


def test_replay_detach_does_not_resurrect_and_isolation(client):
    item,r=opened(client);login(client);fid=str(uuid.uuid4())
    first,path=upload(client,item,r,b'abc','x.txt',fid=fid)
    assert first.status_code==200
    assert upload(client,item,r,b'abc','x.txt',fid=fid)[0].json()==first.json()
    assert upload(client,item,r,b'changed','x.txt',fid=fid)[0].status_code==409
    assert upload(client,item,r,b'abc','renamed.txt',fid=fid)[0].status_code==409
    detached=post(client,path+'/detach',{'revision':2});assert detached.status_code==200
    assert post(client,path+'/detach',{'revision':2}).json()==detached.json()
    assert client.get(path).status_code==404
    assert upload(client,item,r,b'abc','x.txt',fid=fid)[0].status_code==410
    client.post('/api/v1/auth/demo-login',json={'account_id':'demo-client-2'})
    assert client.get(path).status_code==404
    assert upload(client,item,r,b'abc','x.txt',fid=fid)[0].status_code==404
    login(client,'staff')
    assert post(client,path+'/detach',{'revision':3}).status_code==403
    assert client.get(path.replace('/applications/','/staff/applications/')).status_code==404


def test_parallel_upload_and_submit_are_serialized(client):
    item,r=opened(client,True);login(client);path=base(item)+'/'+r['id']
    item=client.patch(path+'/reply',json={'revision':1,'reply_text':'Ответ'}).json();r=item['info_requests'][0]
    with TestClient(app) as other:
        login(other)
        with ThreadPoolExecutor(2) as pool:
            one=pool.submit(upload,client,item,r,b'abc','x.txt')
            two=pool.submit(post,other,path+'/reply/submit',{'version':item['version'],'revision':r['revision']})
            assert one.result()[0].status_code==200
            assert two.result().status_code in (409,422)
    current=client.get('/api/v1/applications/'+item['id']).json()
    assert current['status']=='NEEDS_INFO' and len(current['info_requests'][0]['attachments'])==1


def test_file_ids_must_belong_to_request_and_parallel_uploads_conflict(client):
    item,r=opened(client);login(client)
    with TestClient(app) as other:
        login(other)
        with ThreadPoolExecutor(2) as pool:
            responses=list(pool.map(lambda pair:upload(pair[0],item,r,pair[1],'x.txt')[0],[(client,b'a'),(other,b'b')]))
        assert sorted(x.status_code for x in responses)==[200,409]
    item=client.get('/api/v1/applications/'+item['id']).json();r=item['info_requests'][0];fid=r['attachments'][0]['id']
    wrong=base(item)+'/'+str(uuid.uuid4())+'/attachments/'+fid
    assert client.get(wrong).status_code==404
    assert post(client,wrong+'/detach',{'revision':r['revision']}).status_code==404
    other,r2=opened(client);login(client)
    wrong=base(other)+'/'+r2['id']+'/attachments/'+fid
    assert client.get(wrong).status_code==404
    assert post(client,wrong+'/detach',{'revision':1}).status_code==404
    assert upload(client,other,r2,b'a','x.txt',fid=fid)[0].status_code==409
