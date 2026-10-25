"""Read-only request projection; never fetch deferred binary content for JSON."""
from sqlalchemy import select
from .models import Account, InfoRequest, InfoMessage, InfoAttachment, StaffFinancialCorrection


def serialize_info_requests(application_id, db, *, staff=False):
    result=[]
    for item in db.scalars(select(InfoRequest).where(InfoRequest.application_id==application_id).order_by(InfoRequest.created_at,InfoRequest.id)):
        messages=db.scalars(select(InfoMessage).where(InfoMessage.request_id==item.id).order_by(InfoMessage.created_at,InfoMessage.id)).all()
        files=db.scalars(select(InfoAttachment).where(InfoAttachment.request_id==item.id,InfoAttachment.detached_at.is_(None)).order_by(InfoAttachment.created_at,InfoAttachment.id)).all()
        if staff:
            files = [f for f in files if f.message_id is not None or (item.closed_at is not None and item.reply_submitted_at is None)]
        corrections=db.scalars(select(StaffFinancialCorrection).where(StaffFinancialCorrection.request_id==item.id).order_by(StaffFinancialCorrection.recorded_at,StaffFinancialCorrection.id)).all()
        result.append({'id':str(item.id),'question':item.question,'reason':item.reason,'document_required':item.document_required,'financial_required':item.financial_required,
                       'revision':item.revision,'reply_text':item.reply_text if not staff or (item.closed_at and not item.reply_submitted_at) else '','source':'SELF_REPORTED','created_by':item.created_by,
                       'reply_submitted_at':item.reply_submitted_at.isoformat() if item.reply_submitted_at else None,'created_at':item.created_at.isoformat(),'reply_by':item.reply_by,'closed_by':item.closed_by,
                       'closed_at':item.closed_at.isoformat() if item.closed_at else None,
                       'financial_values':item.financial_values,'financial_accepted_at':item.financial_accepted_at.isoformat() if item.financial_accepted_at else None,
                       'staff_corrections':[{'id':c.id,'actor_id':c.actor_id,'actor_name':db.get(Account,c.actor_id).name,'recorded_at':c.recorded_at.isoformat(),'reason':c.reason,'values':c.values} for c in corrections],
                       'messages':[{'id':m.id,'text':m.text,'actor_id':m.actor_id,'actor_role':m.actor_role,'created_at':m.created_at.isoformat()} for m in messages],
                       'attachments':[{'id':str(f.id),'message_id':f.message_id,'filename':f.filename,'content_type':f.content_type,'size_bytes':f.size_bytes,'actor_id':f.actor_id,'created_at':f.created_at.isoformat()} for f in files]})
    return result
