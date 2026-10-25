import type {Application} from './types';
export function applicationNumber(item:Pick<Application,'id'|'application_number'>) {
  if(item.application_number!=null)return String(item.application_number).padStart(6,'0');
  // Compatibility for old saved API fixtures; real API always supplies the number.
  const legacy=item.id.slice(-6);
  return /^\d+$/.test(legacy)?legacy:'—';
}
