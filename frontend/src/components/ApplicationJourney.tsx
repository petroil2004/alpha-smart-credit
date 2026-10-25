export default function ApplicationJourney({status,step}:{status:string;step?:string}) {
  if(status==='DECLINED')return null;
  const current=status==='DRAFT'?0:['APPROVED','ISSUED'].includes(status)?2:1;
  const stages=[
    ['Подготовка заявки',step??'Заявка отправлена'],
    ['Рассмотрение',status==='NEEDS_INFO'?'Требуются уточнения от клиента':current===1?'Заявка на рассмотрении':'После отправки заявки'],
    ['Предложение и оформление',status==='ISSUED'?'Демонстрационное финансирование получено.':status==='APPROVED'?'Подтвердите условия и получите финансирование.':'После решения банка'],
  ];
  return <div className="journey-card"><h2>Путь заявки</h2><ol className="journey">{stages.map(([title,description],index)=><li key={title} className={current===index?'current':''} aria-current={current===index?'step':undefined}><span>{index+1}</span><div><strong>{title}</strong><small>{description}</small></div></li>)}</ol></div>;
}
