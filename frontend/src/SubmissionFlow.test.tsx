import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { createApi } from './api';
import { ApiError } from './api';
import { application, contractServer } from './test/api-fixtures';

beforeEach(() => { window.history.replaceState(null, '', '/'); sessionStorage.clear(); });
async function setup(overrides = {}) {
  const item = application({purpose:'Закупка товаров',product_code:'working_capital',amount_rub:'3000000.00',term_months:36,...overrides});
  const server = contractServer({loggedIn:true, applications:[item]});
  const user = userEvent.setup();
  const api = createApi(server.fetcher);
  const view = render(<App api={api}/>);
  await user.click(await screen.findByRole('button',{name:/Открыть заявку/}));
  await user.click(screen.getByRole('button',{name:'Перейти к шагу «Проверка»'}));
  return {item,server,user,api,view};
}
const checkbox = () => screen.getByRole('checkbox',{name:/Подтверждаю актуальность/});
const send = () => screen.getByRole('button',{name:'Отправить заявку'});

it('submit waits for pending save and uses returned version', async () => {
  const h=await setup();
  let release!:()=>void;
  h.server.holdSaves(new Promise<void>(resolve=>{release=resolve;}));
  await h.user.click(screen.getByRole('button',{name:'Изменить потребность'}));
  fireEvent.change(screen.getByLabelText('На что нужны средства'),{target:{value:'Новая закупка'}});
  await h.user.click(screen.getByRole('button',{name:'Перейти к шагу «Проверка»'}));
  await waitFor(()=>expect(checkbox()).not.toBeDisabled());
  await h.user.click(checkbox());
  await h.user.click(send());
  expect(h.server.fetcher.mock.calls.some(([url])=>String(url).endsWith('/submit'))).toBe(false);
  await act(async()=>release());
  expect(await screen.findByRole('heading',{name:'Заявка на рассмотрении'})).toBeInTheDocument();
  const call=h.server.fetcher.mock.calls.find(([url])=>String(url).endsWith('/submit'))!;
  expect(JSON.parse(String(call[1]?.body)).version).toBe(2);
  expect(h.server.store.get(h.item.id)?.purpose).toBe('Новая закупка');
});

it('failed save prevents submission',async()=>{
  const h=await setup();
  h.server.failNextSave(503);
  await h.user.click(screen.getByRole('button',{name:'Изменить потребность'}));
  fireEvent.change(screen.getByLabelText('На что нужны средства'),{target:{value:'Сохранить'}});
  await h.user.click(screen.getByRole('button',{name:'Перейти к шагу «Проверка»'}));
  await waitFor(()=>expect(checkbox()).not.toBeDisabled());
  await h.user.click(checkbox()); await h.user.click(send());
  expect(h.server.fetcher.mock.calls.some(([url])=>String(url).endsWith('/submit'))).toBe(false);
  expect(h.server.store.get(h.item.id)?.status).toBe('DRAFT');
});

it('submitted card survives reopening',async()=>{
  const h=await setup();
  await waitFor(()=>expect(checkbox()).not.toBeDisabled());
  await h.user.click(checkbox()); await h.user.click(send());
  await screen.findByRole('heading',{name:'Заявка на рассмотрении'});
  expect(screen.queryByRole('button',{name:'Помочь с выбором'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Удалить|Изменить/})).not.toBeInTheDocument();
  await h.user.click(screen.getByRole('button',{name:'Все заявки'}));
  await h.user.click(await screen.findByRole('button',{name:/Открыть заявку/}));
  expect(await screen.findByRole('heading',{name:'Заявка на рассмотрении'})).toBeInTheDocument();
});

it('confirmation resets on edited data',async()=>{
  const h=await setup(); await waitFor(()=>expect(checkbox()).not.toBeDisabled());
  await h.user.click(checkbox());
  await h.user.click(screen.getByRole('button',{name:'Изменить потребность'}));
  fireEvent.change(screen.getByLabelText('На что нужны средства'),{target:{value:'Изменение'}});
  await h.user.click(screen.getByRole('button',{name:'Перейти к шагу «Проверка»'}));
  expect(checkbox()).not.toBeChecked(); expect(send()).toBeDisabled();
});

it('missing purpose blocks the review step',async()=>{
  const h=await setup({purpose:null});
  expect(screen.getByRole('button',{name:'Перейти к шагу «Проверка»'})).toBeDisabled();
  await h.user.click(screen.getByRole('button',{name:'Перейти к шагу «Параметры»'}));
  expect(screen.getByLabelText('На что нужны средства')).toHaveValue('');
  expect(screen.getByRole('button',{name:'Продолжить'})).toBeDisabled();
});

it('equipment application remains available for completion and submission',async()=>{
  const h=await setup({product_code:'equipment',equipment_cost_rub:'3500000.00'});
  expect(screen.getByRole('button',{name:'Отправить заявку'})).toBeInTheDocument();
  expect(screen.queryByText(/Отправка этого продукта пока недоступна/)).not.toBeInTheDocument();
  await h.user.click(screen.getByRole('button',{name:'Все заявки'}));
  expect(await screen.findByRole('heading',{name:'Мои заявки'})).toBeInTheDocument();
});

it('lost response retries same key after remount',async()=>{
  const h=await setup();
  h.server.failNextSubmitAfterCommit();
  await waitFor(()=>expect(checkbox()).not.toBeDisabled());
  await h.user.click(checkbox()); await h.user.click(send());
  await screen.findByRole('button',{name:'Проверить отправку'});
  const initial=h.server.fetcher.mock.calls.find(([url])=>String(url).endsWith('/submit'))!;
  // Simulate a GET that is temporarily stale after losing the POST reply.
  const stored=h.server.store.get(h.item.id)!;
  h.server.store.set(h.item.id,h.item);
  h.view.unmount(); render(<App api={h.api}/>);
  const retry=await screen.findByRole('button',{name:'Проверить отправку'});
  h.server.store.set(h.item.id,stored);
  await h.user.click(retry);
  expect(await screen.findByRole('heading',{name:'Заявка на рассмотрении'})).toBeInTheDocument();
  const calls=h.server.fetcher.mock.calls.filter(([url])=>String(url).endsWith('/submit'));
  expect(calls.at(-1)?.[1]?.body).toBe(initial[1]?.body);
  expect(new Headers(calls.at(-1)?.[1]?.headers).get('Idempotency-Key')).toBe(new Headers(initial[1]?.headers).get('Idempotency-Key'));
});

it('unavailable sessionStorage blocks submit clearly',async()=>{
  const h=await setup();
  const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('unavailable');});
  try {
    await waitFor(()=>expect(checkbox()).not.toBeDisabled());
    await h.user.click(checkbox()); await h.user.click(send());
    expect(await screen.findByRole('alert')).toHaveTextContent(/сохранить.*повтора/i);
    expect(h.server.fetcher.mock.calls.some(([url])=>String(url).endsWith('/submit'))).toBe(false);
  } finally { spy.mockRestore(); }
});

it('catalog conflict refreshes shown conditions and requires fresh confirmation',async()=>{
 const item=application({purpose:'Закупка',product_code:'working_capital',amount_rub:'3000000.00',term_months:36});
 const server=contractServer({loggedIn:true,applications:[item]});const original=createApi(server.fetcher);
 let changed=false;
 const api={...original,products:vi.fn(async()=>({...await original.products(),catalog_version:changed?'new-catalog':'2026-10-23.1'})),
   calculateAnnuity:async(input:Parameters<typeof original.calculateAnnuity>[0])=>({...await original.calculateAnnuity(input),catalog_version:changed?'new-catalog':'2026-10-23.1'}),
   submit:vi.fn(async()=>{changed=true;throw new ApiError(409,'CATALOG_VERSION_CONFLICT','Условия изменились');})};
 const user=userEvent.setup();render(<App api={api}/>);
 await user.click(await screen.findByRole('button',{name:/Открыть заявку/}));
 await user.click(screen.getByRole('button',{name:'Перейти к шагу «Проверка»'}));
 await waitFor(()=>expect(checkbox()).not.toBeDisabled());await user.click(checkbox());await user.click(send());
 await screen.findByText('Условия изменились');
 expect(checkbox()).not.toBeChecked();
 await waitFor(()=>expect(api.products).toHaveBeenCalledTimes(2));
});

it('confirmation stays reset after editing then reverting the same values',async()=>{
 const h=await setup();await waitFor(()=>expect(checkbox()).not.toBeDisabled());
 await h.user.click(checkbox());
 await h.user.click(screen.getByRole('button',{name:'Изменить потребность'}));
 const field=screen.getByLabelText('На что нужны средства');
 fireEvent.change(field,{target:{value:'Другое значение'}});
 fireEvent.change(field,{target:{value:'Закупка товаров'}});
 await h.user.click(screen.getByRole('button',{name:'Перейти к шагу «Проверка»'}));
 expect(checkbox()).not.toBeChecked();expect(send()).toBeDisabled();
});

it('submission requires a ready calculation shown to the client',async()=>{
 const item=application({purpose:'Закупка',product_code:'working_capital',amount_rub:'3000000.00',term_months:36});
 const server=contractServer({loggedIn:true,applications:[item]});
 const api={...createApi(server.fetcher),calculateAnnuity:async()=>{throw new ApiError(503,'SERVER_ERROR','Расчёт недоступен');}};
 const user=userEvent.setup();render(<App api={api}/>);
 await user.click(await screen.findByRole('button',{name:/Открыть заявку/}));
 await user.click(screen.getByRole('button',{name:'Перейти к шагу «Проверка»'}));
 await screen.findByText('Расчёт недоступен');
 expect(checkbox()).toBeDisabled();expect(send()).toBeDisabled();
 expect(screen.getByRole('button',{name:'Все заявки'})).toBeEnabled();
});

it('explicit server state check recovers a corrupt local retry receipt',async()=>{
 const h=await setup();
 // A damaged local receipt does not change the authoritative server DRAFT.
 const {saveAttempt}=await import('./submission');
 saveAttempt('demo-client-1',h.item.id,{key:crypto.randomUUID(),body:{version:1,profile_version:'profile-v1',catalog_version:'2026-10-23.1',confirmed:true}});
 sessionStorage.setItem(sessionStorage.key(0)!,'{damaged');
 h.view.unmount();render(<App api={h.api}/>);
 const recovery=await screen.findByRole('button',{name:'Обновить карточку'});
 await h.user.click(recovery);
 await h.user.click(await screen.findByRole('button',{name:'Перейти к шагу «Проверка»'}));
 await waitFor(()=>expect(checkbox()).not.toBeDisabled());
 expect(checkbox()).not.toBeChecked();
 await h.user.click(checkbox());await h.user.click(send());
 expect(await screen.findByRole('heading',{name:'Заявка на рассмотрении'})).toBeInTheDocument();
});

it('initial submission replay accepts a current NEEDS_INFO state',async()=>{
 const h=await setup();h.server.failNextSubmitAfterCommit();await waitFor(()=>expect(checkbox()).not.toBeDisabled());await h.user.click(checkbox());await h.user.click(send());
 const retry=await screen.findByRole('button',{name:'Проверить отправку'});
 const submitted=h.server.store.get(h.item.id)!;h.server.store.set(h.item.id,{...submitted,status:'NEEDS_INFO',info_requests:[]});
 await h.user.click(retry);expect(await screen.findByRole('heading',{name:'Нужны дополнительные сведения'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Проверить отправку'})).not.toBeInTheDocument();
});
