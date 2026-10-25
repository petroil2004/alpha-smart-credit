import {useId} from 'react';
import type {CompanyProfile,PulseLevel} from '../types';

const states={GREEN:{badge:'Стабильно',title:'Финансы под контролем',description:'Поступления, расходы и долговая нагрузка в устойчивом соотношении.'},YELLOW:{badge:'Есть зоны внимания',title:'Есть показатели, за которыми стоит следить',description:'Посмотрите на долю средств после расходов и текущую долговую нагрузку.'},RED:{badge:'Требует внимания',title:'Финансовым показателям нужно внимание',description:'Нестабильные поступления или высокая нагрузка уменьшают свободные средства бизнеса.'}};
const compact=(value:string)=>new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}).format(Number(value))+' ₽';
const percent=(value:string)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(value))+'%';
const month=(value:string)=>new Intl.DateTimeFormat('ru-RU',{month:'short',timeZone:'UTC'}).format(new Date(value+'-01T00:00:00Z')).replace('.','');
const period=(value:string)=>new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')).replace(' г.','');
const tone=(level:PulseLevel)=>level.toLowerCase();

export default function FinancialPulse({profile}:{profile:CompanyProfile}){
 const gradient=useId().replaceAll(':','');
 const pulse=profile.financial_pulse;
 if(!pulse||pulse.status!=='READY'||pulse.score===null||!pulse.level||!pulse.metrics)return <section className="financial-pulse pulse-empty" aria-labelledby={gradient+'-title'}>
  <div className="pulse-header"><div><p className="pulse-eyebrow">Ваш бизнес в цифрах</p><h2 id={gradient+'-title'}>Финансовый пульс</h2></div><span className="pulse-badge pulse-neutral">Недостаточно данных</span></div>
  <div className="pulse-empty-content"><span aria-hidden="true">↗</span><div><h3>Не удалось построить финансовый пульс</h3><p>Не хватает данных для расчёта.{pulse?.missing.length?' Нужны: '+pulse.missing.join(', ')+'.':' Нужны поступления и расходы за шесть месяцев, а также текущие платежи по долгам.'}</p></div></div>
 </section>;
 const {metrics,series}=pulse,state=states[pulse.level];
 const width=960,height=300,left=92,right=26,top=24,bottom=48;
 const max=Math.max(1,...series.flatMap(row=>[Number(row.income_rub),Number(row.expenses_rub)]))*1.12;
 const x=(i:number)=>left+i*(width-left-right)/Math.max(1,series.length-1);
 const y=(v:number)=>top+(height-top-bottom)*(1-v/max);
 const points=(field:'income_rub'|'expenses_rub')=>series.map((row,i)=>`${x(i)},${y(Number(row[field]))}`).join(' ');
 const change=metrics.income_change_percent===null?null:Number(metrics.income_change_percent);
 const growth=change===null?'Среднее за шесть месяцев':change===0?'Без изменений за 3 мес.':`${change>0?'↗ +':'↘ '}${percent(metrics.income_change_percent!)} за 3 мес.`;
 const ring=2*Math.PI*54;
 return <section className={`financial-pulse pulse-${tone(pulse.level)}`} aria-labelledby={gradient+'-title'}>
  <div className="pulse-header"><div><p className="pulse-eyebrow">Ваш бизнес в цифрах</p><h2 id={gradient+'-title'}>Финансовый пульс</h2><p className="pulse-period">{profile.finance?period(profile.finance.period.start_date)+' — '+period(profile.finance.period.end_date):'Последние шесть месяцев'}</p></div><span className="pulse-badge">{state.badge}</span></div>
  <div className="pulse-overview"><div className="pulse-gauge" role="img" aria-label={`Финансовый пульс: ${pulse.score} из 100. ${state.badge}`}><svg viewBox="0 0 128 128" aria-hidden="true"><circle className="pulse-ring-track" cx="64" cy="64" r="54"/><circle className="pulse-ring-fill" cx="64" cy="64" r="54" strokeDasharray={`${ring*pulse.score/100} ${ring}`} transform="rotate(-90 64 64)"/></svg><div><strong>{pulse.score}</strong><span>из 100</span></div></div><div className="pulse-assessment"><h3>{state.title}</h3><p>{state.description}</p><span className="pulse-model-note">Оценка состояния бизнеса, а не решение по кредиту</span></div></div>
  <div className="pulse-metrics">
   <article><p>Средние поступления</p><strong>{compact(metrics.average_income_rub)}</strong><small className={change===null||change===0?'':change>0?'metric-green':'metric-yellow'}>{growth}</small></article>
   <article><p>Доля средств после расходов</p><strong>{percent(metrics.margin_percent)}</strong><small className={'metric-'+tone(metrics.margin_level)}>{metrics.margin_level==='GREEN'?'Хороший запас':metrics.margin_level==='YELLOW'?'Небольшой запас':'Низкий запас средств'}</small></article>
   <article><p>Долговая нагрузка</p><strong>{metrics.debt_load_percent===null?'—':percent(metrics.debt_load_percent)}</strong><small className={'metric-'+tone(metrics.debt_level)}>{metrics.debt_load_percent===null?'Нет положительного потока':metrics.debt_level==='GREEN'?'Низкая':metrics.debt_level==='YELLOW'?'Умеренная':'Высокая'} · от потока после расходов</small></article>
   <article><p>Свободный поток в месяц</p><strong>{compact(metrics.free_flow_rub)}</strong><small className={Number(metrics.free_flow_rub)>0?'metric-green':'metric-red'}>После расходов и платежей по долгам</small></article>
  </div>
  <div className="pulse-chart-heading"><h3>Динамика поступлений и расходов</h3><div className="pulse-legend"><span>Поступления</span><span>Расходы</span></div></div>
  <div className="pulse-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={gradient+'-chart-title'}><title id={gradient+'-chart-title'}>Поступления и операционные расходы за шесть месяцев</title><defs><linearGradient id={gradient+'-area'} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6aa7ff" stopOpacity="0.18"/><stop offset="100%" stopColor="#6aa7ff" stopOpacity="0"/></linearGradient></defs>
   {[0,1,2,3].map(i=>{const value=max*i/3;return <g key={i}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} className="pulse-grid"/><text x={left-14} y={y(value)+4} textAnchor="end">{compact(String(value))}</text></g>;})}
   <polygon points={`${left},${y(0)} ${points('income_rub')} ${x(series.length-1)},${y(0)}`} fill={`url(#${gradient}-area)`}/>
   <polyline points={points('expenses_rub')} className="pulse-expenses-line"/><polyline points={points('income_rub')} className="pulse-income-line"/>
   {series.map((row,i)=><g key={row.month}><circle cx={x(i)} cy={y(Number(row.income_rub))} r="4" className="pulse-income-dot"><title>{month(row.month)}: {compact(row.income_rub)}</title></circle><text x={x(i)} y={height-16} textAnchor="middle">{month(row.month)}</text></g>)}
  </svg></div>
  <details className="pulse-method"><summary>Как считается пульс</summary><p>Оценка плавно учитывает стабильность поступлений, долю средств после расходов и текущую долговую нагрузку. Чем сильнее колебания, расходы и нагрузка, тем ниже балл. Хорошие показатели обычно дают около 80–85 баллов; даже отличные не означают отсутствие рисков. Максимум отображаемой оценки — 99. От 80 — зелёный уровень, от 50 — жёлтый, ниже — красный.</p><p>Это демонстрационная шкала финансового состояния, отдельная от кредитного скоринга. Возраст бизнеса и параметры кредита здесь не учитываются. Изменение поступлений сравнивает среднее последних трёх месяцев с первыми тремя. Все показатели построены на синтетических данных банка.</p></details>
 </section>;
}
