export function statusLabel(status:string){
 return status==='DRAFT'?'Черновик':status==='NEEDS_INFO'?'Нужны сведения':status==='UNDER_REVIEW'?'На рассмотрении':status==='APPROVED'?'Одобрена':status==='DECLINED'?'Отказ':status==='SUBMITTED'?'Отправлена':'Заявка';
}

export default function StatusBadge({status}:{status:string}){
 return <span className="draft-badge" data-status={status}>{statusLabel(status)}</span>;
}
