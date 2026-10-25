"""Draft privacy and the staff-controlled clarification lifecycle."""
import uuid
import pytest
from test_info_requests import opened, login, base, post, close
from test_info_files import upload


def test_private_drafts_then_explicit_send_and_staff_close(client):
    item,r=opened(client,True);snapshot=item['submission'];login(client)
    path=base(item)+'/'+r['id']
    saved=client.patch(path+'/reply',json={'revision':r['revision'],'reply_text':'Личный черновик'}).json()
    r=saved['info_requests'][0]
    response,download=upload(client,saved,r,b'\x89PNG\r\n\x1a\nsynthetic','statement.png','image/png')
    assert response.status_code==200
    draft=response.json();r=draft['info_requests'][0]
    login(client,'staff')
    staff=client.get('/api/v1/staff/applications/'+item['id']).json()
    assert staff['info_requests'][0]['reply_text']==''
    assert staff['info_requests'][0]['attachments']==[]
    assert 'statement.png' not in str(staff['history'])
    assert client.get(download.replace('/applications/','/staff/applications/')).status_code==404
    assert post(client,base(item,True)+'/'+r['id']+'/close',{'version':draft['version'],'revision':r['revision']}).status_code==409
    login(client)
    payload={'version':draft['version'],'revision':r['revision']};key=str(uuid.uuid4())
    sent=post(client,path+'/reply/submit',payload,key)
    assert sent.status_code==200,sent.text
    sent=sent.json();assert sent['status']=='NEEDS_INFO' and sent['info_requests'][0]['closed_at'] is None
    assert post(client,path+'/reply/submit',payload,key).json()==sent
    assert sent['info_requests'][0]['messages'][-1]['text']=='Личный черновик'
    login(client,'staff')
    assert client.get(download.replace('/applications/','/staff/applications/')).status_code==200
    reply=post(client,base(item,True)+'/'+r['id']+'/messages',{'text':'Уточните период выписки'})
    assert reply.status_code==200
    login(client)
    latest=client.get('/api/v1/applications/'+item['id']).json();r=latest['info_requests'][0]
    latest=client.patch(path+'/reply',json={'revision':r['revision'],'reply_text':'Ещё не отправлено'}).json()
    response,private_url=upload(client,latest,latest['info_requests'][0])
    assert response.status_code==200
    done=close(client,response.json())
    assert done['status']=='UNDER_REVIEW' and done['submission']==snapshot
    assert len(done['info_requests'][0]['messages'])==2
    assert done['info_requests'][0]['reply_text']==''
    assert len(done['info_requests'][0]['attachments'])==1
    assert client.get(private_url.replace('/applications/','/staff/applications/')).status_code==404
    assert post(client,base(item,True)+'/'+r['id']+'/messages',{'text':'Поздно'}).status_code==409
    login(client)
    assert post(client,base(item,True)+'/'+r['id']+'/close',{'version':done['version'],'revision':done['info_requests'][0]['revision']}).status_code==403


@pytest.mark.parametrize('content,name,kind',[(b'%PDF-1.7 synthetic','doc.pdf','application/pdf'),(b'\xff\xd8\xffsynthetic','photo.jpg','image/jpeg'),(b'\x89PNG\r\n\x1a\nsynthetic','photo.png','image/png')])
def test_supported_document_types(client,content,name,kind):
    item,r=opened(client,True);login(client)
    assert upload(client,item,r,content,name,kind)[0].status_code==200
