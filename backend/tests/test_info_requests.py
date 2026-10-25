import uuid
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from app.main import app
from test_submissions import draft, submit


def login(client, role='client'):
    return client.post('/api/v1/auth/demo-login', json={'account_id':'demo-staff-1' if role=='staff' else 'demo-client-1'})


def posted(client):
    item=draft(client)
    response=submit(client,item)
    assert response.status_code==200
    return response.json()


def base(item, staff=False):
    return '/api/v1/'+('staff/' if staff else '')+'applications/'+item['id']+'/info-requests'


def create_request(client,item,required=False,key=None):
    login(client,'staff')
    return client.post(base(item,True),json={'version':item['version'],'question':'Уточните расходы за месяц','reason':'Нужны сведения для рассмотрения','document_required':required},headers={'Idempotency-Key':key or str(uuid.uuid4())})


def opened(client,required=False):
    item=posted(client)
    response=create_request(client,item,required)
    assert response.status_code==200,response.text
    result=response.json()
    return result,result['info_requests'][-1]


def post(client,path,body,key=None):
    return client.post(path,json=body,headers={'Idempotency-Key':key or str(uuid.uuid4())})


def close(client,item):
    login(client,'staff');r=item['info_requests'][-1]
    response=post(client,base(item,True)+'/'+r['id']+'/close',{'version':item['version'],'revision':r['revision']})
    assert response.status_code==200,response.text
    return response.json()


def test_full_text_clarification_keeps_snapshot_and_messages_do_not_close(client):
    item=posted(client);snapshot=item['submission']['snapshot']
    result=create_request(client,item)
    assert result.status_code==200,result.text
    item=result.json();r=item['info_requests'][0];path=base(item)+'/'+r['id']
    assert item['status']=='NEEDS_INFO' and r['revision']==1
    login(client)
    item=client.patch(path+'/reply',json={'revision':1,'reply_text':'Расходы 1000 рублей, со слов клиента'}).json()
    r=item['info_requests'][0];revision=r['revision']
    assert item['status']=='NEEDS_INFO'
    msg=post(client,path+'/messages',{'text':'Какой документ приложить?'})
    assert msg.status_code==200,msg.text
    revision=msg.json()['info_requests'][0]['revision']
    assert revision==r['revision']+1
    assert msg.json()['status']=='NEEDS_INFO'
    login(client,'staff')
    assert post(client,base(item,True)+'/'+r['id']+'/messages',{'text':'Синтетическую справку TXT'}).status_code==200
    assert client.get('/api/v1/staff/applications/'+item['id']).status_code==200
    login(client)
    result=post(client,path+'/reply/submit',{'version':item['version'],'revision':revision})
    assert result.status_code==200,result.text
    result=result.json()
    assert result['status']=='NEEDS_INFO'
    result=close(client,result)
    login(client)
    assert result['submission']['snapshot']==snapshot
    assert result['info_requests'][0]['source']=='SELF_REPORTED'
    assert result['info_requests'][0]['closed_at']
    assert len(result['info_requests'][0]['messages'])==3
    assert post(client,path+'/messages',{'text':'Поздно'}).status_code==409
    assert client.patch(path+'/reply',json={'revision':revision+1,'reply_text':'Изменено'}).status_code==409


def test_only_one_open_request_and_request_replay_survives_new_session(client):
    item=posted(client);key=str(uuid.uuid4())
    first=create_request(client,item,key=key)
    assert first.status_code==200
    assert create_request(client,first.json()).status_code==409
    with TestClient(app) as fresh:
        assert create_request(fresh,item,key=key).json()==first.json()
    changed=post(client,base(item,True),{'version':item['version'],'question':'Другое','reason':'Причина','document_required':False},key)
    assert changed.status_code==409


def test_invalid_versions_required_reply_and_access(client):
    item,r=opened(client);path=base(item)+'/'+r['id']
    login(client)
    assert client.get('/api/v1/staff/applications/'+item['id']).status_code==403
    assert post(client,path+'/reply/submit',{'version':item['version'],'revision':1}).status_code==422
    assert client.patch(path+'/reply',json={'revision':99,'reply_text':'x'}).status_code==409
    assert client.patch(path+'/reply',json={'revision':True,'reply_text':'x'}).status_code==422
    assert post(client,path+'/messages',{'text':' '}).status_code==422
    client.post('/api/v1/auth/demo-login',json={'account_id':'demo-client-2'})
    assert client.patch(path+'/reply',json={'revision':1,'reply_text':'x'}).status_code==404
    assert post(client,path+'/messages',{'text':'x'}).status_code==404
    login(client,'staff')
    assert client.patch(path+'/reply',json={'revision':1,'reply_text':'x'}).status_code==403


def test_late_replays_and_sequential_requests_return_current_state(client):
    item=posted(client);key=str(uuid.uuid4());initial=item
    item=create_request(client,item,key=key).json();r=item['info_requests'][0];path=base(item)+'/'+r['id']
    login(client)
    saved=client.patch(path+'/reply',json={'revision':1,'reply_text':'Данные уточнены'}).json()
    opkey=str(uuid.uuid4());payload={'version':saved['version'],'revision':saved['info_requests'][0]['revision']}
    closed=close(client,post(client,path+'/reply/submit',payload,opkey).json())
    item=create_request(client,closed).json()
    assert len(item['info_requests'])==2
    login(client)
    replay=post(client,path+'/reply/submit',payload,opkey)
    assert replay.status_code==200 and replay.json()['status']=='NEEDS_INFO'
    assert replay.json()['info_requests'][0]['closed_at']
    login(client,'staff')
    assert create_request(client,initial,key=key).json()==item


def test_messages_are_idempotent_and_other_app_path_conflicts(client):
    item,r=opened(client);login(client)
    path=base(item)+'/'+r['id']+'/messages';key=str(uuid.uuid4())
    result=post(client,path,{'text':'Вопрос'},key)
    assert result.status_code==200
    assert post(client,path,{'text':'Вопрос'},key).json()==result.json()
    assert post(client,path,{'text':'Другой'},key).status_code==409
    other=posted(client)
    assert post(client,base(other)+'/'+r['id']+'/messages',{'text':'Вопрос'},key).status_code==404


def test_concurrent_requests_create_only_one_active(client):
    item=posted(client)
    with TestClient(app) as other:
        login(client,'staff');login(other,'staff')
        with ThreadPoolExecutor(2) as pool:
            responses=list(pool.map(lambda c:create_request(c,item),[client,other]))
    assert sorted(r.status_code for r in responses)==[200,409]


@pytest.mark.parametrize('changes', [
    {'version':True}, {'version':0}, {'question':''},
    {'question':'x'*2001}, {'reason':'x'*1001}, {'document_required':'true'}, {'extra':1},
])
def test_request_validation_is_atomic(client, changes):
    item=posted(client);login(client,'staff')
    body={'version':item['version'],'question':'Вопрос','reason':'Причина','document_required':False}|changes
    assert post(client,base(item,True),body).status_code==422
    current=client.get('/api/v1/staff/applications/'+item['id']).json()
    assert current['info_requests']==[] and current['history']==item['history']
    assert current['version']==item['version']


def test_concurrent_saves_and_submit_replays(client):
    item,r=opened(client);path=base(item)+'/'+r['id'];login(client)
    with TestClient(app) as other:
        login(other)
        with ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda args:args[0].patch(path+'/reply',json={'revision':1,'reply_text':args[1]}),[(client,'Первый'),(other,'Второй')]))
        assert sorted(x.status_code for x in results)==[200,409]
        saved=next(x.json() for x in results if x.status_code==200)
        key=str(uuid.uuid4());body={'version':saved['version'],'revision':2}
        with ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda c:post(c,path+'/reply/submit',body,key),[client,other]))
        assert [x.status_code for x in results]==[200,200]
        assert results[0].json()==results[1].json()
        assert sum(x['reason_code']=='INFO_REPLY_SUBMITTED' for x in results[0].json()['history'])==1


def test_create_all_preserves_existing_applications_and_requests(client):
    from app.db import Base,engine
    item,r=opened(client)
    Base.metadata.create_all(engine)
    current=client.get('/api/v1/staff/applications/'+item['id']).json()
    assert current==item
