import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import FundingPanel from './components/FundingPanel';
import {application,session,contractServer} from './test/api-fixtures';
import {createApi} from './api';

it('requires consent, records funding once and shows the persistent success result',async()=>{
 const item=application({status:'APPROVED',application_number:18,amount_rub:'500000.00',product_code:'equipment'});
 const issued={...item,status:'ISSUED',version:2,disbursement:{kind:'CREDITED' as const,amount_rub:'500000.00',confirmed_at:new Date().toISOString()}};
 const api={...createApi(contractServer({loggedIn:true}).fetcher),disburse:vi.fn(async()=>issued)},onUpdated=vi.fn();
 const props={api,session,onUpdated,onSessionChanged:vi.fn()};const user=userEvent.setup();
 const view=render(<FundingPanel {...props} application={item}/>);
 await user.click(screen.getByRole('button',{name:'Получить деньги'}));
 const send=screen.getByRole('button',{name:'Подтвердить и получить'});expect(send).toBeDisabled();
 expect(screen.getByRole('link',{name:/Полные условия/})).toHaveAttribute('href','/credit-terms.html');
 await user.click(screen.getByRole('checkbox'));await user.click(send);
 await waitFor(()=>expect(onUpdated).toHaveBeenCalledWith(issued));expect(api.disburse).toHaveBeenCalledTimes(1);
 view.rerender(<FundingPanel {...props} application={issued}/>);
 expect(screen.getByRole('heading',{name:'Средства зачислены'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Подтвердить и получить'})).not.toBeInTheDocument();
 view.unmount();render(<FundingPanel {...props} application={issued}/>);
 expect(screen.getByRole('heading',{name:'Средства зачислены'})).toBeVisible();
});
